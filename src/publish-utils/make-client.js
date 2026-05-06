import { WebClient, LogLevel } from '@slack/web-api';

/**
 * Create authorized Web Client instance.
 *
 * @param {string} oauthToken Slack OAuth token.
 *
 * @returns {object} Slack WebClient instance.
 */
export const makeClient = (oauthToken) => new WebClient(oauthToken, { logLevel: LogLevel.DEBUG });
