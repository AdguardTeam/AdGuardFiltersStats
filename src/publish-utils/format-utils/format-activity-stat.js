import { getTextBlock } from './get-text-block';
import { isTeamMember } from '../is-team-member';
import { README_URL } from '../../constants';

const TEAM_MEMBERS_STAT_HEADER = ':adguard: *AdGuard team*';
const CONTRIBUTORS_STAT_HEADER = ':bust_in_silhouette: *Contributors*';

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

    let teamMembersStr = '';
    let contributorsStr = '';

    sortedByActivity.forEach((stat) => {
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
