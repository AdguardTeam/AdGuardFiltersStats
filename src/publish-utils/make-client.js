import { WebClient, LogLevel } from '@slack/web-api';

/**
 * Create authorized Web Client instance
 * @param {string} oauthToken
 * @returns {Object} Slack WebClient instance
 */
export const makeClient = (oauthToken) => new WebClient(oauthToken, { logLevel: LogLevel.DEBUG });
