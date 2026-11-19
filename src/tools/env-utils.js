/**
 * Read required environment variables or fail with one line that names them.
 *
 * A CLI entry calls this helper before it reads any other value. Without the
 * check, an absent value surfaces as a `TypeError` far from the cause, or as
 * an unrelated API failure with a stack trace.
 *
 * @param {string[]} names Names of the required variables.
 * @param {NodeJS.ProcessEnv} [env] Source of the values.
 *
 * @returns {Record<string, string>} Values of the required variables by name.
 *
 * @throws {Error} One or more required variables are absent.
 */
export const requireEnvVars = (names, env = process.env) => {
    const missing = names.filter((name) => !env[name]);

    if (missing.length > 0) {
        const noun = missing.length === 1 ? 'variable' : 'variables';
        throw new Error(`${missing.join(', ')} environment ${noun} must be set`);
    }

    return Object.fromEntries(names.map((name) => [name, env[name]]));
};
