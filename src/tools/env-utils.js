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

/**
 * Split a repository identifier in `owner/repo_name` form.
 *
 * A CLI entry reads `REPO` as one variable, while the GitHub API takes the
 * owner and the name separately. A value without both parts cannot reach
 * the API, so it fails here with one line instead of an API error.
 *
 * @param {string} value Repository identifier.
 *
 * @returns {{owner: string, repo: string}} Repository owner and name.
 *
 * @throws {Error} The value is not in `owner/repo_name` form.
 */
export const parseRepo = (value) => {
    const parts = value.split('/');

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new Error(`REPO must be in owner/repo_name form, got "${value}"`);
    }

    const [owner, repo] = parts;

    return { owner, repo };
};
