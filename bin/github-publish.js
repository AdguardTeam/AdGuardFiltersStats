#!/usr/bin/env node
'use strict';

var dotenv = require('dotenv');
var dateFns = require('date-fns');
var prepareStats = require('./prepare-stats-DUH1Xbu4.js');
var fsUtils = require('./fs-utils-GXHCD9bE.js');
var webApi = require('@slack/web-api');
require('@octokit/core');
require('fs-extra');
require('stream');
require('stream-chain');
require('string_decoder');

function _interopNamespaceDefault(e) {
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () { return e[k]; }
                });
            }
        });
    }
    n.default = e;
    return Object.freeze(n);
}

var dotenv__namespace = /*#__PURE__*/_interopNamespaceDefault(dotenv);

/**
 * Creates block with given params
 * @param {string} text
 * @param {string} textType
 * @param {string} blockType
 * @returns {Object}
 */
const getTextBlock = (text, textType = 'mrkdwn', blockType = 'section') => {
  return {
    type: blockType,
    text: {
      type: textType,
      text
    }
  };
};

/**
 * Check if given user is from own team
 * @param {string} username
 * @returns {boolean}
 */
const isTeamMember = username => fsUtils.TEAM_MEMBERS.includes(username);

/**
 * Returns icon code
 * @param {string} username
 * @return {string}
 */
const getUserIcon = username => {
  return isTeamMember(username) ? ':adguard:' : ':bust_in_silhouette:';
};

/**
 * Converts contributor's stats to an array of formatted block messages
 * @param {Object} activitiesByUser activity sorted by users and then by type
 * @returns {Array[]}
 */
const formatUserActivity = activitiesByUser => {
  const userBlocks = [];
  Object.entries(activitiesByUser).forEach(stat => {
    const [username, activities] = stat;
    const {
      resolvedIssues,
      newPulls,
      mergedPulls,
      pullRequestsReview,
      totalCommits,
      totalComments
    } = activities;
    const userBlock = [getTextBlock(`${getUserIcon(username)}*<https://github.com/${username}|${username}>*`),
    // These are split into two blocks to prevent slack
    // from non-configurable block wrapping
    getTextBlock(`
Resolved issues: ${resolvedIssues}
Total commits: ${totalCommits}
Pull requests reviews: ${pullRequestsReview}`), getTextBlock(`
Merged pull requests: ${mergedPulls}
New pull requests: ${newPulls}
Total comments: ${totalComments}`)];
    userBlocks.push(userBlock);
  });
  return userBlocks;
};

const TEAM_MEMBERS_STAT_HEADER = ':adguard: *AdGuard team*';
const CONTRIBUTORS_STAT_HEADER = ':bust_in_silhouette: *Contributors*';

/**
 * Converts activity stat object to an array of Slack blocks
 * @param {Object} activityStat
 * @returns {Object[]}
 */
const formatActivityStat = activityStat => {
  // Render empty block if message url is not supplied
  const legendMessage = getTextBlock(`_By activity points (<${fsUtils.README_URL}|what is it?>)_`);
  const blocks = [getTextBlock('🙇 General contributors statistics', 'plain_text', 'header'), legendMessage];
  const statArray = Object.entries(activityStat);
  const sortedByActivity = statArray.sort((a, b) => {
    if (a[1] > b[1]) {
      return -1;
    }
    return 0;
  });
  let teamMembersStr = '';
  let contributorsStr = '';
  sortedByActivity.forEach(stat => {
    const [username, userstat] = stat;
    const userItemStr = `• ${username}: ${userstat}\n`;
    if (isTeamMember(username)) {
      teamMembersStr += userItemStr;
      return;
    }
    contributorsStr += userItemStr;
  });
  if (teamMembersStr.length > 0) {
    blocks.push(getTextBlock(`${TEAM_MEMBERS_STAT_HEADER}\n${teamMembersStr}`));
  }
  if (contributorsStr.length > 0) {
    blocks.push(getTextBlock(`${CONTRIBUTORS_STAT_HEADER}\n${contributorsStr}`));
  }
  return blocks;
};

/**
 * Prune statistics object to exclude users by given params
 * @param {Object} statistics
 * @param {number} minActivity
 * @returns {Object}
 */
const pruneStatistics = (statistics, minActivity) => {
  const prunedStat = {
    ...statistics
  };
  const {
    activityStat,
    activitiesByUser
  } = prunedStat;

  // eslint-disable-next-line no-restricted-syntax
  for (const [username, count] of Object.entries(activityStat)) {
    const shouldBeRemoved = count <= minActivity || fsUtils.EXCLUDED_USERNAMES.includes(username);
    if (shouldBeRemoved && !isTeamMember(username)) {
      delete activityStat[username];
      delete activitiesByUser[username];
    }
  }
  return prunedStat;
};

/**
 * Converts general repo stat object to array of Slack blocks
 * @param {Object} repoStat
 * @returns {Object[]}
 */
const formatRepoStat = repoStat => {
  const {
    timePeriod,
    newIssues,
    resolvedIssues,
    closedAsStaleIssues,
    newPulls,
    mergedPulls,
    remainingIssues
  } = repoStat;
  const timestamp = dateFns.format(new Date(timePeriod.since), 'EEEE, dd.MM.y');
  const blocks = [getTextBlock(`*${timestamp}*`), getTextBlock('⚡ General repo statistics', 'plain_text', 'header'), getTextBlock(`*Resolved issues:* ${resolvedIssues}`), getTextBlock(`*New issues:* ${newIssues}`), getTextBlock(`*Closed as stale:* ${closedAsStaleIssues}`), getTextBlock(`*New pull requests:* ${newPulls}`), getTextBlock(`*Merged pull requests:* ${mergedPulls}`), getTextBlock(`*Remaining issues:* ${remainingIssues}`)];
  return blocks;
};

/**
 * Create authorized Web Client instance
 * @param {string} oauthToken
 * @returns {Object} Slack WebClient instance
 */
const makeClient = oauthToken => new webApi.WebClient(oauthToken, {
  logLevel: webApi.LogLevel.DEBUG
});

/**
 * Post a message to a channel your app is in
 * @param {Object} client Slack WebClient instance
 * @param {Object[]} message array of formatted blocks
 * @param {string} channelId
 * @returns {Object} object with data about sent message
 */
async function publishMessage(client, message, channelId) {
  let messageInfo;
  try {
    messageInfo = await client.chat.postMessage({
      channel: channelId,
      blocks: message,
      unfurl_links: false,
      unfurl_media: false
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
  }
  return messageInfo;
}

/**
 * Reply to a message with the channel ID and message TS
 * @param {Object} client Slack WebClient instance
 * @param {Object[]} message array of formatted blocks
 * @param {string} channelId
 * @param {string} threadTs id of a thread's parent message
 */
async function replyMessage(client, message, channelId, threadTs) {
  try {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: message,
      unfurl_links: false,
      unfurl_media: false
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(error);
  }
}

/**
 * Prepare and publish statistics data to a Slack channel
 * @param {string} oauthToken
 * @param {string} channelId
 * @param {Object} statistics
 */
const publishStats = async (oauthToken, channelId, statistics) => {
  const {
    repoStat,
    activityStat,
    activitiesByUser
  } = pruneStatistics(statistics, fsUtils.MIN_REQUIRED_ACTIVITY);
  const repoStatBlocks = formatRepoStat(repoStat);
  const generalActivityBlocks = formatActivityStat(activityStat);
  const detailedUserBlocks = formatUserActivity(activitiesByUser);
  const client = makeClient(oauthToken);
  const messageInfo = await publishMessage(client, repoStatBlocks, channelId);
  await replyMessage(client, generalActivityBlocks, channelId, messageInfo.ts);
  for (let i = 0; i < detailedUserBlocks.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await replyMessage(client, detailedUserBlocks[i], channelId, messageInfo.ts);
  }
};

dotenv__namespace.config();
const {
  SLACK_OAUTH_TOKEN,
  SLACK_CHANNEL_ID,
  COLLECTION_PATH,
  REPO,
  SINCE,
  UNTIL
} = process.env;
const commonRequestData = {
  owner: REPO.split('/')[0],
  repo: REPO.split('/')[1]
};

// Set defaults to last 24h period
const timePeriod = {
  since: SINCE || dateFns.startOfYesterday().toISOString(),
  until: UNTIL || dateFns.endOfYesterday().toISOString()
};
(async () => {
  const statistics = await prepareStats.prepareStats(COLLECTION_PATH, commonRequestData, timePeriod);
  await publishStats(SLACK_OAUTH_TOKEN, SLACK_CHANNEL_ID, statistics);
})();
