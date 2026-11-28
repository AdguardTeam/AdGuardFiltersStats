/**
 * Post a message to a channel your app is in.
 *
 * A Slack failure rejects the call, so the entry reports its reason and
 * fails the run instead of continuing with an undefined message.
 *
 * @param {object} client Slack WebClient instance.
 * @param {object[]} message Array of formatted blocks.
 * @param {string} channelId Slack channel ID.
 *
 * @returns {Promise<object>} Object with data about the sent message.
 */
export async function publishMessage(client, message, channelId) {
    return client.chat.postMessage({
        channel: channelId,
        blocks: message,
        unfurl_links: false,
        unfurl_media: false,
    });
}
