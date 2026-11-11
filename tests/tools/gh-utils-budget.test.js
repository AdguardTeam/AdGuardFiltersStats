jest.mock('@octokit/core', () => {
    const request = jest.fn();
    const Octokit = jest.fn().mockImplementation(() => ({ request }));

    return { Octokit, request };
});

// eslint-disable-next-line import/first
import { getClosedIssuesInWindow, getPullsInWindow } from '../../src/tools/gh-utils';
// eslint-disable-next-line import/first
import { logger } from '../../src/tools/logger';

const { request: mockRequest } = jest.requireMock('@octokit/core');

const nextLink = '<https://api.github.com/next>; rel="next"';
const window = { since: '2026-04-21T00:00:00Z', until: '2026-04-21T23:59:59Z' };
const commonRequestData = { owner: 'o', repo: 'r' };

/**
 * Build an issues page with one in-window issue and a next-page link.
 *
 * @param {number} number Issue number.
 *
 * @returns {object} Octokit response.
 */
const buildIssuePage = (number) => ({
    headers: { link: nextLink },
    data: [{
        id: number,
        number,
        closed_at: '2026-04-21T10:00:00Z',
        updated_at: '2026-04-21T10:00:00Z',
        closed_by: { login: 'alice' },
        labels: [],
    }],
});

/**
 * Build a pull request page with one in-window pull request and a next-page link.
 *
 * @param {number} number Pull request number.
 *
 * @returns {object} Octokit response.
 */
const buildPullPage = (number) => ({
    headers: { link: nextLink },
    data: [{
        id: number,
        number,
        created_at: '2026-04-21T09:00:00Z',
        merged_at: null,
        updated_at: '2026-04-21T09:00:00Z',
        user: { login: 'alice', id: 1 },
    }],
});

describe('REST window walks — time budget', () => {
    beforeEach(() => {
        mockRequest.mockReset();
        jest.spyOn(logger, 'log').mockImplementation(() => {});
        jest.spyOn(logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('does not request an issues page when the budget is already spent', async () => {
        const budget = { deadline: Date.now() - 1, truncated: false };

        const issues = await getClosedIssuesInWindow(commonRequestData, window, { budget });

        expect(issues).toEqual([]);
        expect(budget.truncated).toBe(true);
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('stops the issues walk after the page that uses up the budget', async () => {
        const base = Date.now();
        const budget = {
            deadline: base + 5000, truncated: false, progress: true,
        };
        jest.spyOn(Date, 'now')
            .mockReturnValueOnce(base)
            .mockReturnValue(base + 6000);
        mockRequest.mockResolvedValue(buildIssuePage(100));

        const issues = await getClosedIssuesInWindow(commonRequestData, window, { budget });

        expect(issues.map((issue) => issue.number)).toEqual([100]);
        expect(budget.truncated).toBe(true);
        expect(mockRequest).toHaveBeenCalledTimes(1);
        expect(logger.log).toHaveBeenCalledWith(
            expect.stringContaining('getClosedIssuesInWindow: fetching page 1'),
        );
    });

    it('does not log each page when progress is off', async () => {
        const base = Date.now();
        const budget = { deadline: base + 5000, truncated: false };
        jest.spyOn(Date, 'now')
            .mockReturnValueOnce(base)
            .mockReturnValue(base + 6000);
        mockRequest.mockResolvedValue(buildIssuePage(100));

        await getClosedIssuesInWindow(commonRequestData, window, { budget });

        expect(logger.log).not.toHaveBeenCalled();
    });

    it('keeps the issues collected before a budget-capped request times out', async () => {
        const base = Date.now();
        const budget = { deadline: base + 5000, truncated: false };
        jest.spyOn(Date, 'now')
            .mockReturnValueOnce(base)
            .mockReturnValueOnce(base + 2000)
            .mockReturnValue(base + 6000);
        const controller = new AbortController();
        controller.abort();
        jest.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
        mockRequest
            .mockResolvedValueOnce(buildIssuePage(100))
            .mockRejectedValueOnce(new Error('The user aborted a request.'));

        const issues = await getClosedIssuesInWindow(commonRequestData, window, { budget });

        expect(issues.map((issue) => issue.number)).toEqual([100]);
        expect(budget.truncated).toBe(true);
        expect(mockRequest).toHaveBeenCalledTimes(2);
    });

    it('caps the request timeout by the remaining budget', async () => {
        const base = Date.now();
        const budget = { deadline: base + 5000, truncated: false };
        jest.spyOn(Date, 'now')
            .mockReturnValueOnce(base)
            .mockReturnValue(base + 6000);
        const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
        mockRequest.mockResolvedValue(buildIssuePage(100));

        await getClosedIssuesInWindow(commonRequestData, window, { budget });

        expect(timeoutSpy).toHaveBeenCalledWith(5000);
    });

    it('propagates a 30 s timeout that the budget did not cap', async () => {
        const budget = { deadline: Date.now() + 60 * 1000, truncated: false };
        jest.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
        mockRequest.mockRejectedValueOnce(new Error('The user aborted a request.'));

        await expect(getClosedIssuesInWindow(commonRequestData, window, { budget }))
            .rejects.toThrow('Request timed out after 30000 ms');
        expect(budget.truncated).toBe(false);
    });

    it('propagates a REST error that lands after the deadline', async () => {
        const base = Date.now();
        const budget = { deadline: base + 5000, truncated: false };
        jest.spyOn(Date, 'now')
            .mockReturnValueOnce(base)
            .mockReturnValue(base + 6000);
        mockRequest.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }));

        await expect(getClosedIssuesInWindow(commonRequestData, window, { budget }))
            .rejects.toThrow('Not Found');
        expect(budget.truncated).toBe(false);
    });

    it('marks the walk truncated when the page safety limit is reached', async () => {
        const budget = { deadline: Date.now() + 60 * 1000, truncated: false };
        mockRequest.mockResolvedValue(buildIssuePage(100));

        const issues = await getClosedIssuesInWindow(commonRequestData, window, { budget });

        expect(issues).toHaveLength(30);
        expect(budget.truncated).toBe(true);
        expect(mockRequest).toHaveBeenCalledTimes(30);
    });

    it('does not request a pulls page when the budget is already spent', async () => {
        const budget = { deadline: Date.now() - 1, truncated: false };

        const pulls = await getPullsInWindow(commonRequestData, window, { budget });

        expect(pulls).toEqual([]);
        expect(budget.truncated).toBe(true);
        expect(mockRequest).not.toHaveBeenCalled();
    });

    it('stops the pulls walk after the page that uses up the budget', async () => {
        const base = Date.now();
        const budget = { deadline: base + 5000, truncated: false };
        jest.spyOn(Date, 'now')
            .mockReturnValueOnce(base)
            .mockReturnValue(base + 6000);
        mockRequest.mockResolvedValue(buildPullPage(200));

        const pulls = await getPullsInWindow(commonRequestData, window, { budget });

        expect(pulls.map((pull) => pull.number)).toEqual([200]);
        expect(budget.truncated).toBe(true);
        expect(mockRequest).toHaveBeenCalledTimes(1);
    });
});
