import { getTextBlock } from './get-text-block';
import { isTeamMember } from '../is-team-member';
import { README_URL } from '../../constants';

/**
 * Converts activity stat object to an array of Slack blocks
 * @param {Object} activityStat
 * @returns {Object[]}
 */
export const formatActivityStat = (activityStat) => {
    // Render empty block if message url is not supplied
    const legendMessage = getTextBlock(`_By activity points (<${README_URL}|what is it?>)_`);
    const blocks = [
        getTextBlock('🙇 General contributors statistics', 'plain_text', 'header'),
        legendMessage,
    ];

    const statArray = Object.entries(activityStat);
    const sortedByActivity = statArray.sort((a, b) => {
        if (a[1] > b[1]) {
            return -1;
        }
        return 0;
    });

    let teamMembers = ':adguard: *AdGuard team*\n';
    let contributors = ':bust_in_silhouette: *Contributors*\n';

    sortedByActivity.forEach((stat) => {
        const [username, userstat] = stat;
        const userString = `• ${username}: ${userstat}\n`;

        if (isTeamMember(username)) {
            teamMembers += userString;
            return;
        }

        contributors += userString;
    });

    blocks.push(getTextBlock(teamMembers));
    blocks.push(getTextBlock(contributors));

    return blocks;
};
