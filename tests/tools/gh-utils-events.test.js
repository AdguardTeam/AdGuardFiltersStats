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
    beforeEach(() => {
        jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
            callback();
            return 0;
        });
        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        mockRequest.mockReset();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns events from one page without a retry', async () => {
        mockRequest.mockResolvedValue(buildResponse([{ id: '1' }, { id: '2' }]));

        const result = await getGithubEvents({ owner: 'o', repo: 'r' });

        expect(result.events.map((event) => event.id)).toEqual(['1', '2']);
        expect(result.metadata.pagesCollected).toBe(1);
        expect(mockRequest).toHaveBeenCalledTimes(1);
    });

    it('retries a failed page and returns all pages', async () => {
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
    });

    it('fails after three retries of the same page', async () => {
        mockRequest.mockRejectedValue(buildError('Unexpected end of JSON input', 500));

        await expect(getGithubEvents({ owner: 'o', repo: 'r' }))
            .rejects.toThrow('Error fetching GitHub events: Unexpected end of JSON input');
        expect(mockRequest).toHaveBeenCalledTimes(4);
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
            .rejects.toThrow(/GitHub API rate limit exceeded/);
        expect(mockRequest).toHaveBeenCalledTimes(1);
    });
});
