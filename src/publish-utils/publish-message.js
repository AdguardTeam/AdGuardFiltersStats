/**
 * Post a message to a channel your app is in
 * @param {Object} client Slack WebClient instance
 * @param {Object[]} message array of formatted blocks
 * @param {string} channelId
 * @returns {Object} object with data about sent message
 */
export async function publishMessage(client, message, channelId) {
    let messageInfo;
    try {
        messageInfo = await client.chat.postMessage({
            channel: channelId,
            blocks: message,
            unfurl_links: false,
            unfurl_media: false,
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
    }

    return messageInfo;
}
