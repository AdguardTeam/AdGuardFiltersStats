/**
 * Reply to a message with the channel ID and message TS.
 *
 * A Slack failure rejects the call, so the entry reports its reason and
 * fails the run instead of exiting 0 with a partially published report.
 *
 * @param {object} client Slack WebClient instance.
 * @param {object[]} message Array of formatted blocks.
 * @param {string} channelId Slack channel ID.
 * @param {string} threadTs ID of a thread's parent message.
 *
 * @returns {Promise<object>} Object with data about the sent reply.
 */
export async function replyMessage(client, message, channelId, threadTs) {
    return client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: message,
        unfurl_links: false,
        unfurl_media: false,
    });
}
