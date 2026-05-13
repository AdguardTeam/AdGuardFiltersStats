/* eslint-disable no-console */

/**
 * Simple logger that wraps console methods.
 *
 * Centralizes the `no-console` ESLint disable to a single file.
 */
const logger = {
    /**
     * Log an informational message.
     *
     * @param {...unknown} args Arguments forwarded to console.log.
     *
     * @returns {void}
     */
    log: (...args) => console.log(...args),

    /**
     * Log a warning message.
     *
     * @param {...unknown} args Arguments forwarded to console.warn.
     *
     * @returns {void}
     */
    warn: (...args) => console.warn(...args),

    /**
     * Log an error message.
     *
     * @param {...unknown} args Arguments forwarded to console.error.
     *
     * @returns {void}
     */
    error: (...args) => console.error(...args),
};

export { logger };
