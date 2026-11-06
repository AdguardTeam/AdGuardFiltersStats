import { isRateLimitError, isTransientError, withRetry } from '../../src/tools/retry-utils';

/**
 * Build an error with an optional HTTP status and response headers.
 *
 * @param {string} message Error message.
 * @param {number} [status] HTTP status.
 * @param {object} [headers] Response headers.
 *
 * @returns {Error} Error object.
 */
const buildError = (message, status, headers) => Object.assign(new Error(message), {
    status,
    response: headers ? { headers } : undefined,
});

describe('retry-utils', () => {
    let setTimeoutMock;
    let consoleWarnSpy;

    beforeEach(() => {
        setTimeoutMock = jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
            callback();
            return 0;
        });
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    /**
     * Collect delays passed to the stubbed `setTimeout`.
     *
     * @returns {Array<number>} Delays in milliseconds.
     */
    const retryDelays = () => setTimeoutMock.mock.calls.map(([, delay]) => delay);

    describe('isRateLimitError', () => {
        it('detects a primary rate limit response', () => {
            expect(isRateLimitError(buildError('API rate limit exceeded', 403, {
                'x-ratelimit-remaining': '0',
            }))).toBe(true);
            expect(isRateLimitError(buildError('API rate limit exceeded', 429, {
                'x-ratelimit-remaining': '0',
            }))).toBe(true);
            expect(isRateLimitError(buildError('Server error', 500, {
                'x-ratelimit-remaining': '0',
            }))).toBe(true);
        });

        it('detects a secondary rate limit response', () => {
            expect(isRateLimitError(buildError('Secondary rate limit exceeded', 429, {
                'retry-after': '60',
            }))).toBe(true);
            expect(isRateLimitError(buildError('Secondary rate limit exceeded', 403, {
                'retry-after': '60',
            }))).toBe(true);
        });

        it('does not treat retry-after on a server error as a rate limit response', () => {
            expect(isRateLimitError(buildError('Service unavailable', 503, {
                'retry-after': '60',
            }))).toBe(false);
        });

        it('detects a bare 429 response', () => {
            expect(isRateLimitError(buildError('Too many requests', 429))).toBe(true);
        });

        it('does not treat a regular client error as a rate limit response', () => {
            expect(isRateLimitError(buildError('Not found', 404))).toBe(false);
        });
    });

    describe('isTransientError', () => {
        it('treats a malformed response body as transient', () => {
            expect(isTransientError(buildError('Unexpected end of JSON input', 500))).toBe(true);
        });

        it('treats an error without a status as transient', () => {
            expect(isTransientError(new Error('request callback failed'))).toBe(true);
        });

        it('treats server responses as transient', () => {
            expect(isTransientError(buildError('Server error', 500))).toBe(true);
            expect(isTransientError(buildError('Service unavailable', 503, {
                'retry-after': '60',
            }))).toBe(true);
        });

        it('treats client responses as permanent', () => {
            expect(isTransientError(buildError('Not found', 404))).toBe(false);
            expect(isTransientError(buildError('Forbidden', 403))).toBe(false);
        });

        it('treats rate limit responses as permanent', () => {
            expect(isTransientError(buildError('Too many requests', 429))).toBe(false);
            expect(isTransientError(buildError('API rate limit exceeded', 403, {
                'x-ratelimit-remaining': '0',
            }))).toBe(false);
            expect(isTransientError(buildError('Server error', 500, {
                'x-ratelimit-remaining': '0',
            }))).toBe(false);
        });
    });

    describe('withRetry', () => {
        it('returns the first result when the request succeeds', async () => {
            const request = jest.fn().mockResolvedValue('ok');

            await expect(withRetry(request)).resolves.toBe('ok');
            expect(request).toHaveBeenCalledTimes(1);
        });

        it('retries a transient error and returns the next result', async () => {
            const request = jest.fn()
                .mockRejectedValueOnce(buildError('Server error', 500))
                .mockResolvedValue('ok');

            await expect(withRetry(request)).resolves.toBe('ok');
            expect(request).toHaveBeenCalledTimes(2);
        });

        it('retries an error without a status', async () => {
            const request = jest.fn()
                .mockRejectedValueOnce(new Error('request callback failed'))
                .mockResolvedValue('ok');

            await expect(withRetry(request)).resolves.toBe('ok');
            expect(request).toHaveBeenCalledTimes(2);
        });

        it('stops after three retries and throws the last error', async () => {
            const error = buildError('Server error', 500);
            const request = jest.fn().mockRejectedValue(error);

            await expect(withRetry(request)).rejects.toBe(error);
            expect(request).toHaveBeenCalledTimes(4);
            expect(retryDelays()).toEqual([1000, 2000, 4000]);
        });

        it('does not retry a client error', async () => {
            const error = buildError('Not found', 404);
            const request = jest.fn().mockRejectedValue(error);

            await expect(withRetry(request)).rejects.toBe(error);
            expect(request).toHaveBeenCalledTimes(1);
        });

        it('does not retry a rate limit response', async () => {
            const error = buildError('API rate limit exceeded', 403, {
                'x-ratelimit-remaining': '0',
            });
            const request = jest.fn().mockRejectedValue(error);

            await expect(withRetry(request)).rejects.toBe(error);
            expect(request).toHaveBeenCalledTimes(1);
        });

        it('uses the given retry count', async () => {
            const error = buildError('Server error', 502);
            const request = jest.fn().mockRejectedValue(error);

            await expect(withRetry(request, { retries: 1 })).rejects.toBe(error);
            expect(request).toHaveBeenCalledTimes(2);
        });

        it('includes the request label and status in the warning', async () => {
            const request = jest.fn()
                .mockRejectedValueOnce(buildError('Server error', 500))
                .mockResolvedValue('ok');

            await withRetry(request, { label: 'Events API page 8' });

            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Events API page 8'));
            expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('500'));
        });
    });
});
