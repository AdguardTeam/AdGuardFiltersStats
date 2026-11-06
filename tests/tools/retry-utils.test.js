import { isTransientError, withRetry } from '../../src/tools/retry-utils';

/**
 * Build an error with an optional HTTP status.
 *
 * @param {string} message Error message.
 * @param {number} [status] HTTP status.
 *
 * @returns {Error} Error object.
 */
const buildError = (message, status) => Object.assign(new Error(message), { status });

describe('retry-utils', () => {
    beforeEach(() => {
        jest.spyOn(global, 'setTimeout').mockImplementation((callback) => {
            callback();
            return 0;
        });
        jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('isTransientError', () => {
        it('treats an error without a status as transient', () => {
            expect(isTransientError(new Error('Unexpected end of JSON input'))).toBe(true);
        });

        it('treats server and throttling responses as transient', () => {
            expect(isTransientError(buildError('Server error', 500))).toBe(true);
            expect(isTransientError(buildError('Too many requests', 429))).toBe(true);
        });

        it('treats client responses as permanent', () => {
            expect(isTransientError(buildError('Not found', 404))).toBe(false);
            expect(isTransientError(buildError('Forbidden', 403))).toBe(false);
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
                .mockRejectedValueOnce(new Error('socket hang up'))
                .mockResolvedValue('ok');

            await expect(withRetry(request)).resolves.toBe('ok');
            expect(request).toHaveBeenCalledTimes(2);
        });

        it('stops after three retries and throws the last error', async () => {
            const error = buildError('Server error', 500);
            const request = jest.fn().mockRejectedValue(error);

            await expect(withRetry(request)).rejects.toBe(error);
            expect(request).toHaveBeenCalledTimes(4);
        });

        it('does not retry a client error', async () => {
            const error = buildError('Not found', 404);
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
    });
});
