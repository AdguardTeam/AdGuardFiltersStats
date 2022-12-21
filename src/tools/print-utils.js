import { format } from 'date-fns';

const repoStatToString = (repoStats) => {
    const { until, since } = repoStats.timePeriod;
    const statString = `
    ## General repo statistics \n
    Repo statistics for the period from ${format(new Date(since), 'yyy-MM-dd HH-mm-ss')} to ${format(new Date(until), 'yyy-MM-dd HH-mm-ss')}. \n
    * New issues: ${repoStats.newIssues}
    * Resolved issues: ${repoStats.resolvedIssues}
    * Closed as stale: ${repoStats.closedAsStaleIssues}
    * New pull requests: ${repoStats.newPulls}
    * Merged pull requests: ${repoStats.mergedPulls}
    * Remaining issues: ${repoStats.remainingIssues}
    `.replace(/  +/g, '');

    return statString;
};

const activityToString = (activityStat) => {
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

const activityByTimeToString = (activitiesByTime) => {
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

export {
    repoStatToString,
    activityToString,
    detailedActivityToString,
};
