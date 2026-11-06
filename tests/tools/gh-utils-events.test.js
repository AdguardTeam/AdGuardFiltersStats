jest.mock('@octokit/core', () => {
    const request = jest.fn();
    const Octokit = jest.fn().mockImplementation(() => ({ request }));

    return { Octokit, request };
});

// eslint-disable-next-line import/first
import { getGithubEvents } from '../../src/tools/gh-utils';

const { request: mockRequest } = jest.requireMock('@octokit/core');

/**
 * Build an error with an optional HTTP status.
 *
 * @param {string} message Error message.
 * @param {number} [status] HTTP status.
 *
 * @returns {Error} Error object.
 */
const buildError = (message, status) => Object.assign(new Error(message), { status });

/**
 * Build an Octokit response with one page of events.
 *
 * @param {Array<object>} data Events on the page.
 * @param {string} [link] Value of the `link` header.
 *
 * @returns {object} Octokit response.
 */
const buildResponse = (data, link) => ({
    headers: {
        link,
        'x-ratelimit-remaining': '4999',
        'x-ratelimit-reset': '1800000000',
    },
    data,
});

describe('getGithubEvents', () => {
    let consoleWarnSpy;

    beforeEach(() => {
        jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
            callback();
            return 0;
        });
        jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        mockRequest.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('sets a 30 second timeout signal on every request', async () => {
        const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
        const { signal } = new AbortController();
        timeoutSpy.mockReturnValue(signal);
        mockRequest.mockResolvedValue(buildResponse([{ id: '1' }]));

        await getGithubEvents({ owner: 'o', repo: 'r' });

        expect(timeoutSpy).toHaveBeenCalledWith(30 * 1000);
        expect(mockRequest.mock.calls[0][1].request.signal).toBe(signal);
    });

    it('returns events from one page without a retry', async () => {
        mockRequest.mockResolvedValue(buildResponse([{ id: '1' }, { id: '2' }]));

        const result = await getGithubEvents({ owner: 'o', repo: 'r' });

        expect(result.events.map((event) => event.id)).toEqual(['1', '2']);
        expect(result.metadata.pagesCollected).toBe(1);
        expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('retries a failed page and returns all pages', async () => {
        const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
        mockRequest
            .mockRejectedValueOnce(buildError('invalid json response body', 500))
            .mockResolvedValueOnce(buildResponse(
                [{ id: '1' }],
                '<https://api.github.com/repos/o/r/events?page=2>; rel="next"',
            ))
            .mockResolvedValueOnce(buildResponse([{ id: '2' }]));

        const result = await getGithubEvents({ owner: 'o', repo: 'r' });

        expect(result.events.map((event) => event.id)).toEqual(['1', '2']);
        expect(result.metadata.pagesCollected).toBe(2);
        expect(mockRequest).toHaveBeenCalledTimes(3);
        expect(mockRequest.mock.calls.map(([, params]) => params.page)).toEqual([1, 1, 2]);
        // Every attempt, including the retry, gets its own timeout signal.
        expect(timeoutSpy).toHaveBeenCalledTimes(3);
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Events API page 1'));
        expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('500'));
    });

    it('fails after three retries of the same page', async () => {
        mockRequest.mockRejectedValue(buildError('Unexpected end of JSON input', 500));

        await expect(getGithubEvents({ owner: 'o', repo: 'r' }))
            .rejects.toThrow('Error fetching GitHub events: Unexpected end of JSON input');
        expect(mockRequest).toHaveBeenCalledTimes(4);
        expect(mockRequest.mock.calls.map(([, params]) => params.page)).toEqual([1, 1, 1, 1]);
    });

    it('does not retry a rate limit response', async () => {
        mockRequest.mockRejectedValue({
            status: 403,
            message: 'API rate limit exceeded',
            response: {
                headers: {
                    'x-ratelimit-remaining': '0',
                    'x-ratelimit-reset': '1800000000',
                },
            },
        });

        await expect(getGithubEvents({ owner: 'o', repo: 'r' }))
            .rejects.toThrow('GitHub API rate limit exceeded. Limit will reset at 2027-01-15T08:00:00.000Z');
        expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('does not retry a primary rate limit 429 response', async () => {
        mockRequest.mockRejectedValue({
            status: 429,
            message: 'API rate limit exceeded',
            response: {
                headers: {
                    'x-ratelimit-remaining': '0',
                    'x-ratelimit-reset': '1800000000',
                },
            },
        });

        await expect(getGithubEvents({ owner: 'o', repo: 'r' }))
            .rejects.toThrow('GitHub API rate limit exceeded. Limit will reset at 2027-01-15T08:00:00.000Z');
        expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('does not retry a secondary rate limit response', async () => {
        mockRequest.mockRejectedValue({
            status: 429,
            message: 'You have exceeded a secondary rate limit',
            response: {
                headers: {
                    'retry-after': '60',
                },
            },
        });

        await expect(getGithubEvents({ owner: 'o', repo: 'r' }))
            .rejects.toThrow('GitHub API rate limit exceeded. Retry in 60 seconds');
        expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('reports retry-after ahead of the hourly reset for a secondary limit', async () => {
        mockRequest.mockRejectedValue({
            status: 403,
            message: 'You have exceeded a secondary rate limit',
            response: {
                headers: {
                    'x-ratelimit-remaining': '4321',
                    'x-ratelimit-reset': '1800000000',
                    'retry-after': '60',
                },
            },
        });

        const error = await getGithubEvents({ owner: 'o', repo: 'r' }).catch((e) => e);

        expect(error.message).toBe('GitHub API rate limit exceeded. Retry in 60 seconds');
        expect(error.rateLimitReached).toBe(true);
        expect(error.rateLimitReset).toBeNull();
        expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('exposes the rate limit state on the thrown error', async () => {
        mockRequest.mockRejectedValue({
            status: 403,
            message: 'API rate limit exceeded',
            response: {
                headers: {
                    'x-ratelimit-remaining': '0',
                    'x-ratelimit-reset': '1800000000',
                },
            },
        });

        const error = await getGithubEvents({ owner: 'o', repo: 'r' }).catch((e) => e);

        expect(error.message).toBe('GitHub API rate limit exceeded. Limit will reset at 2027-01-15T08:00:00.000Z');
        expect(error.rateLimitReached).toBe(true);
        expect(error.rateLimitReset).toBe('2027-01-15T08:00:00.000Z');
    });
});
