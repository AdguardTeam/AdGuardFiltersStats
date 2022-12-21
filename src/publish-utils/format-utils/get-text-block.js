/**
 * Creates block with given params
 * @param {string} text
 * @param {string} textType
 * @param {string} blockType
 * @returns {Object}
 */
export const getTextBlock = (text, textType = 'mrkdwn', blockType = 'section') => {
    return {
        type: blockType,
        text: {
            type: textType,
            text,
        },
    };
};
