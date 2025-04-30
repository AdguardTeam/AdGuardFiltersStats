import { isTeamMember } from '../is-team-member.js';

/**
 * Returns icon code
 * @param {string} username
 * @return {string}
 */
export const getUserIcon = (username) => {
    return isTeamMember(username) ? ':adguard:' : ':bust_in_silhouette:';
};
