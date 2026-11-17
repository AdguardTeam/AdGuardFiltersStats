/**
 * Maximum length of an error message that reaches a log line or a metadata record.
 *
 * A GitHub API failure can carry a long response body, and the poll metadata
 * is committed to the repository. The limit keeps one record readable and the
 * commit diff small.
 */
export const MAX_ERROR_MESSAGE_LENGTH = 300;

/**
 * Read the text of an error, an error message, or any thrown value.
 *
 * The helper runs inside `catch` blocks, so it never throws: a failure here
 * would replace the error it describes.
 *
 * @param {unknown} errorOrMessage Error object, error message, or thrown value.
 *
 * @returns {string} Text of the value, or an empty string when it carries none.
 */
const toText = (errorOrMessage) => {
    if (typeof errorOrMessage === 'string') {
        return errorOrMessage;
    }

    try {
        if (errorOrMessage && typeof errorOrMessage.message === 'string') {
            return errorOrMessage.message;
        }

        if (errorOrMessage === null || errorOrMessage === undefined) {
            return '';
        }

        return String(errorOrMessage);
    } catch {
        // An object without a primitive conversion carries no readable text.
        return '';
    }
};

/**
 * Convert an error or an error message into one bounded line.
 *
 * Every whitespace run becomes one space, so an API response body that spans
 * several lines cannot break a log line or a stored metadata record. A message
 * longer than {@link MAX_ERROR_MESSAGE_LENGTH} is cut and ends with `...`. A
 * cut never splits a surrogate pair.
 *
 * @param {unknown} errorOrMessage Error object, error message, or thrown value.
 *
 * @returns {string} Single-line message of at most {@link MAX_ERROR_MESSAGE_LENGTH} characters.
 */
export const normalizeErrorMessage = (errorOrMessage) => {
    const text = toText(errorOrMessage).replace(/\s+/g, ' ').trim();

    if (text.length <= MAX_ERROR_MESSAGE_LENGTH) {
        return text;
    }

    const cut = text.slice(0, MAX_ERROR_MESSAGE_LENGTH - 3)
        .replace(/[\uD800-\uDBFF]$/, '');

    return `${cut}...`;
};
