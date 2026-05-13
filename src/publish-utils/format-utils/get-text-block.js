/**
 * Creates block with given params.
 *
 * @param {string} text Block text content.
 * @param {string} textType Slack text type.
 * @param {string} blockType Slack block type.
 *
 * @returns {object} Slack Block Kit block object.
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
