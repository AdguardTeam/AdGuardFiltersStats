import { isTeamMember } from '../is-team-member';

/**
 * Returns icon code.
 *
 * @param {string} username GitHub username.
 *
 * @returns {string} Slack emoji code for the user icon.
 */
export const getUserIcon = (username) => {
    return isTeamMember(username) ? ':adguard:' : ':bust_in_silhouette:';
};
