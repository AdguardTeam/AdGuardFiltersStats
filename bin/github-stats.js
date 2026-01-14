#!/usr/bin/env node
'use strict';

var dotenv = require('dotenv');
var prepareStats = require('./prepare-stats-C5dIYjKe.js');
var dateFns = require('date-fns');
require('./fs-utils-DxFsNDOK.js');
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

const repoStatToString = repoStats => {
  const {
    until,
    since
  } = repoStats.timePeriod;
  const statString = `
    ## General repo statistics \n
    Repo statistics for the period from ${dateFns.format(new Date(since), 'yyy-MM-dd HH-mm-ss')} to ${dateFns.format(new Date(until), 'yyy-MM-dd HH-mm-ss')}. \n
    * New issues: ${repoStats.newIssues}
    * Resolved issues: ${repoStats.resolvedIssues}
    * Closed as stale: ${repoStats.closedAsStaleIssues}
    * New pull requests: ${repoStats.newPulls}
    * Merged pull requests: ${repoStats.mergedPulls}
    * Remaining issues: ${repoStats.remainingIssues}
    `.replace(/  +/g, '');
  return statString;
};
const activityToString = activityStat => {
  const statArray = Object.entries(activityStat);
  const sortedByActivity = statArray.sort((a, b) => {
    if (a[1] > b[1]) {
      return -1;
    }
    return 0;
  });
  let statString = '\n## General contributors statistics \n\n';
  sortedByActivity.forEach((contributor, index) => {
    const statLine = `${index + 1}. ${contributor[0]}: ${contributor[1]}\n`;
    statString += statLine;
  });
  return statString;
};
const hourlyActivityToString = (hourlyContributorActivity, date) => {
  const totalActivity = hourlyContributorActivity.reduce((prev, current) => prev + current, 0);
  if (totalActivity <= 0) {
    return '';
  }
  let hourlyStatString = `
    \n*Date*
    *${date}*\n
    hour \t activity
    `.replace(/  +/g, '');
  hourlyContributorActivity.forEach((activity, hour) => {
    const bar = `|${'█'.repeat(activity)}`;
    hourlyStatString += `\n${hour} \t ${activity} \t ${bar}`;
  });
  return hourlyStatString;
};
const activityByTimeToString = activitiesByTime => {
  let activityByTimeString = '\n*Daily activity*';
  // eslint-disable-next-line no-restricted-syntax
  for (const [date, activities] of Object.entries(activitiesByTime)) {
    activityByTimeString += hourlyActivityToString(activities, date);
  }
  return activityByTimeString;
};
const detailedActivityToString = (activitiesByUser, activitiesByTime) => {
  let statString = '\n## Detailed contributor statistics';

  // eslint-disable-next-line no-restricted-syntax
  for (const [name, activities] of Object.entries(activitiesByUser)) {
    let contributorString = `
        \n\n### ${name}\n
        * Resolved issues: ${activities.resolvedIssues}
        * New pull requests (merged): ${activities.newPulls} (${activities.mergedPulls})
        * Pull requests review activity: ${activities.pullRequestsReview}
        * Total commits: ${activities.totalCommits}
        * Total comments: ${activities.totalComments}
        `.replace(/  +/g, '');
    contributorString += activityByTimeToString(activitiesByTime[name]);
    statString += contributorString;
  }
  return statString;
};

/* eslint-disable no-console */

/**
 * Prepares statistics strings and prints them to console
 *
 * @param {Object} statistics
 */
const printStats = statistics => {
  const {
    repoStat,
    activityStat,
    activitiesByUser,
    activitiesByTime
  } = statistics;
  const generalRepoStatsString = repoStatToString(repoStat);
  const generalActivityString = activityToString(activityStat);
  const detailedActivityString = detailedActivityToString(activitiesByUser, activitiesByTime);
  console.log(generalRepoStatsString);
  console.log(generalActivityString);
  console.log(detailedActivityString);
};

dotenv__namespace.config();
const {
  COLLECTION_PATH,
  REPO,
  SINCE,
  UNTIL
} = process.env;
const commonRequestData = {
  owner: REPO.split('/')[0],
  repo: REPO.split('/')[1]
};
const timePeriod = {
  until: UNTIL || new Date().toISOString(),
  since: SINCE
};
(async () => {
  const statistics = await prepareStats.prepareStats(COLLECTION_PATH, commonRequestData, timePeriod);
  printStats(statistics);
})();
