import { format } from 'date-fns';
import { getTextBlock } from './get-text-block.js';

/**
 * Converts general repo stat object to array of Slack blocks
 * @param {Object} repoStat
 * @returns {Object[]}
 */
export const formatRepoStat = (repoStat) => {
    const {
        timePeriod,
        newIssues,
        resolvedIssues,
        closedAsStaleIssues,
        newPulls,
        mergedPulls,
        remainingIssues,
    } = repoStat;

    const timestamp = format(new Date(timePeriod.since), 'EEEE, dd.MM.y');

    const blocks = [
        getTextBlock(`*${timestamp}*`),
        getTextBlock('⚡ General repo statistics', 'plain_text', 'header'),
        getTextBlock(`*Resolved issues:* ${resolvedIssues}`),
        getTextBlock(`*New issues:* ${newIssues}`),
        getTextBlock(`*Closed as stale:* ${closedAsStaleIssues}`),
        getTextBlock(`*New pull requests:* ${newPulls}`),
        getTextBlock(`*Merged pull requests:* ${mergedPulls}`),
        getTextBlock(`*Remaining issues:* ${remainingIssues}`),
    ];

    return blocks;
};
