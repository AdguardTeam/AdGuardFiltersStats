import { isTeamMember } from '../is-team-member';
import { EXCLUDED_USERNAMES } from '../../constants';

/**
 * Prune statistics object to exclude users by given params.
 *
 * @param {object} statistics Aggregated statistics object.
 * @param {number} minActivity Minimum activity threshold.
 *
 * @returns {object} Pruned statistics object.
 */
export const pruneStatistics = (statistics, minActivity) => {
    const prunedStat = {
        ...statistics,
    };

    const {
        activityStat,
        activitiesByUser,
    } = prunedStat;

    // eslint-disable-next-line no-restricted-syntax
    for (const [username, count] of Object.entries(activityStat)) {
        const shouldBeRemoved = count <= minActivity || EXCLUDED_USERNAMES.includes(username);
        if (shouldBeRemoved && !isTeamMember(username)) {
            delete activityStat[username];
            delete activitiesByUser[username];
        }
    }

    return prunedStat;
};
