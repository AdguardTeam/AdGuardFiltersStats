import { TEAM_MEMBERS } from '../constants';

/**
 * Check if given user is from own team
 * @param {string} username
 * @returns {boolean}
 */
export const isTeamMember = (username) => TEAM_MEMBERS.includes(username);
