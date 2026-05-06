import { TEAM_MEMBERS } from '../constants';

/**
 * Check if given user is from own team.
 *
 * @param {string} username GitHub username.
 *
 * @returns {boolean} True if username is in the team members list.
 */
export const isTeamMember = (username) => TEAM_MEMBERS.includes(username);
