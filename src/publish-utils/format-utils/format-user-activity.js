import { getTextBlock } from './get-text-block';
import { getUserIcon } from './get-user-icon';

/**
 * Converts contributor's stats to an array of formatted block messages
 * @param {Object} activitiesByUser activity sorted by users and then by type
 * @returns {Array[]}
 */
export const formatUserActivity = (activitiesByUser) => {
    const userBlocks = [];

    Object.entries(activitiesByUser).forEach((stat) => {
        const [username, activities] = stat;
        const {
            resolvedIssues,
            newPulls,
            mergedPulls,
            pullRequestsReview,
            totalCommits,
            totalComments,
        } = activities;

        const userBlock = [
            getTextBlock(`${getUserIcon(username)}*<https://github.com/${username}|${username}>*`),
            // These are split into two blocks to prevent slack
            // from non-configurable block wrapping
            getTextBlock(`
Resolved issues: ${resolvedIssues}
Total commits: ${totalCommits}
Pull requests reviews: ${pullRequestsReview}`),
            getTextBlock(`
Merged pull requests: ${mergedPulls}
New pull requests: ${newPulls}
Total comments: ${totalComments}`),
        ];

        userBlocks.push(userBlock);
    });

    return userBlocks;
};
