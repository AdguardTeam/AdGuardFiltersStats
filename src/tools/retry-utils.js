import { logger } from './logger';

/**
 * Maximum number of retries after the first failed attempt.
 */
const DEFAULT_RETRIES = 3;

/**
 * Base delay before the first retry in milliseconds.
 *
 * Each next retry doubles the delay.
 */
const RETRY_BASE_DELAY_MS = 1000;

/**
 * Header name for the remaining GitHub API rate limit quota.
 */
const X_RATE_LIMIT_REMAINING_HEADER = 'x-ratelimit-remaining';

/**
 * Header name for the time GitHub asks to wait before a retry.
 */
const RETRY_AFTER_HEADER = 'retry-after';

/**
 * Wait for the given number of milliseconds.
 *
 * @param {number} ms Delay in milliseconds.
 *
 * @returns {Promise<void>} Promise that resolves after the delay.
 */
const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

/**
 * Report whether an error is a GitHub rate limit response.
 *
 * A response with `x-ratelimit-remaining: 0` is a primary rate limit
 * whatever its status, although GitHub normally uses 403 or 429. A
 * secondary rate limit response carries `retry-after` with a 403 or a
 * 429 status. GitHub returns a bare 429 only for rate limiting, so it
 * counts as well. Retrying inside the window GitHub asks to wait out
 * cannot succeed, so such responses are never retried.
 *
 * @param {Error & {status?: number, response?: {headers?: object}}} error Error raised by a request.
 *
 * @returns {boolean} `true` when GitHub rate-limited the request.
 */
export const isRateLimitError = (error) => {
    const status = error?.status;

    if (status === 429) {
        return true;
    }

    const headers = error?.response?.headers;

    if (!headers) {
        return false;
    }

    if (headers[X_RATE_LIMIT_REMAINING_HEADER] === '0') {
        return true;
    }

    return status === 403 && headers[RETRY_AFTER_HEADER] !== undefined;
};

/**
 * Report whether an error is transient and a retry can succeed.
 *
 * `@octokit/request` wraps network failures and malformed response bodies
 * into a request error with status 500, so they are retried by the
 * server-error check. An error without an HTTP status is thrown by the
 * request callback itself and is retried as well. Client errors and rate
 * limit responses are not retried.
 *
 * @param {Error & {status?: number, response?: {headers?: object}}} error Error raised by a request.
 *
 * @returns {boolean} `true` when a retry can succeed.
 */
export const isTransientError = (error) => {
    if (isRateLimitError(error)) {
        return false;
    }

    if (typeof error?.status !== 'number') {
        return true;
    }

    return error.status >= 500;
};

/**
 * Run a request and retry transient failures with exponential backoff.
 *
 * @param {() => Promise<unknown>} request Function that performs one request.
 * @param {object} [options] Retry options.
 * @param {number} [options.retries] Maximum number of retries after the first attempt.
 * @param {string} [options.label] Human-readable request description for warnings.
 *
 * @returns {Promise<unknown>} Result of the first successful attempt.
 *
 * @throws {Error} The last error when every attempt fails, or the first error when it is not transient.
 */
export const withRetry = async (request, { retries = DEFAULT_RETRIES, label = 'Request' } = {}) => {
    const attemptsLimit = retries + 1;
    let attempt = 0;

    for (;;) {
        attempt += 1;

        try {
            return await request();
        } catch (error) {
            if (!isTransientError(error) || attempt >= attemptsLimit) {
                throw error;
            }

            const delay = RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
            const status = typeof error?.status === 'number' ? error.status : 'no status';

            logger.warn(
                `${label} failed (attempt ${attempt} of ${attemptsLimit}, ${status}): ${error.message}. `
                + `Retrying in ${delay} ms.`,
            );

            await sleep(delay);
        }
    }
};
