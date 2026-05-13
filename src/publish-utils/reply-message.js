/**
 * Reply to a message with the channel ID and message TS.
 *
 * @param {object} client Slack WebClient instance.
 * @param {object[]} message Array of formatted blocks.
 * @param {string} channelId Slack channel ID.
 * @param {string} threadTs ID of a thread's parent message.
 */
export async function replyMessage(client, message, channelId, threadTs) {
    try {
        await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            blocks: message,
            unfurl_links: false,
            unfurl_media: false,
        });
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error(error);
    }
}
