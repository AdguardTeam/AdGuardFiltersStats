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
 * Wait for the given number of milliseconds.
 *
 * @param {number} ms Delay in milliseconds.
 *
 * @returns {Promise<void>} Promise that resolves after the delay.
 */
export const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});

/**
 * Report whether an error is transient and a retry can succeed.
 *
 * An error without an HTTP status comes from a network failure or a
 * malformed response body. Server errors and throttling responses are
 * transient as well. Client errors, including rate limit responses, are
 * not retried.
 *
 * @param {Error & {status?: number}} error Error raised by a request.
 *
 * @returns {boolean} `true` when a retry can succeed.
 */
export const isTransientError = (error) => {
    if (typeof error?.status !== 'number') {
        return true;
    }

    return error.status >= 500 || error.status === 429;
};

/**
 * Run a request and retry transient failures with exponential backoff.
 *
 * @param {() => Promise<unknown>} request Function that performs one request.
 * @param {object} [options] Retry options.
 * @param {number} [options.retries] Maximum number of retries after the first attempt.
 *
 * @returns {Promise<unknown>} Result of the first successful attempt.
 *
 * @throws {Error} The last error when every attempt fails, or the first error when it is not transient.
 */
export const withRetry = async (request, { retries = DEFAULT_RETRIES } = {}) => {
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

            logger.warn(
                `Request failed (attempt ${attempt} of ${attemptsLimit}): ${error.message}. `
                + `Retrying in ${delay} ms.`,
            );

            await sleep(delay);
        }
    }
};
