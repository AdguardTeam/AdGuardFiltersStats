import { Octokit } from '@octokit/core';
import { isBefore, isWithinInterval } from 'date-fns';
import { ENDPOINTS, MAX_NUMBER_OF_MOST_RECENT_EVENTS } from '../constants';
import { logger } from './logger';

const { GITHUB_TOKEN } = process.env;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

/**
 * Maximum number of pages to fetch per paginated request to prevent runaway loops.
 */
const MAX_PAGES = 30;

/**
 * Header names for rate limit information.
 *
 * @see {@link https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28#checking-the-status-of-your-rate-limit}
 */
const X_RATE_LIMIT_RESET_HEADER = 'x-ratelimit-reset';

/**
 * Header name for remaining API requests.
 *
 * @see {@link https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api?apiVersion=2022-11-28#checking-the-status-of-your-rate-limit}
 */
const X_RATE_LIMIT_REMAINING_HEADER = 'x-ratelimit-remaining';

/**
 * Get GitHub events from with pagination.
 *
 * @param {object} commonRequestData Common request data for GitHub API.
 *
 * @returns {Promise<object>} Object containing events array and metadata.
 */
export const getGithubEvents = async (commonRequestData = {}) => {
    const collectedPages = [];
    let totalEvents = 0;
    let rateLimitReached = false;
    let rateLimitRemaining = null;
    let rateLimitReset = null;

    try {
        let currentLink = 'rel="next"';
        let pageNumber = 1;
        while (currentLink && currentLink.includes('rel="next"')) {
            const { headers, data } = await octokit.request(ENDPOINTS.GITHUB_EVENTS, {
                ...commonRequestData,
                page: pageNumber,
            });

            // Track rate limit information
            rateLimitRemaining = parseInt(headers[X_RATE_LIMIT_REMAINING_HEADER], 10);
            rateLimitReset = parseInt(headers[X_RATE_LIMIT_RESET_HEADER], 10);

            // Store data and update counters
            collectedPages.push(data);
            totalEvents += data.length;

            currentLink = headers.link;
            pageNumber += 1;

            // Check if we're approaching rate limit
            if (rateLimitRemaining < 5) {
                logger.warn(`GitHub API rate limit nearly reached. ${rateLimitRemaining} requests remaining.`);
                logger.warn(`Rate limit will reset at ${new Date(rateLimitReset * 1000).toISOString()}`);
                rateLimitReached = true;
                break;
            }
        }
    } catch (error) {
        if (error.status === 403 && error.response?.headers?.[X_RATE_LIMIT_REMAINING_HEADER] === '0') {
            rateLimitReached = true;
            rateLimitReset = parseInt(error.response.headers[X_RATE_LIMIT_RESET_HEADER], 10);
            throw new Error(
                `GitHub API rate limit exceeded. Limit will reset at ${new Date(rateLimitReset * 1000).toISOString()}`,
            );
        } else {
            throw new Error(`Error fetching GitHub events: ${error.message}`);
        }
    }

    // Log information about the collection
    logger.log(`Collected ${totalEvents} events across ${collectedPages.length} pages`);

    // Notify if we hit API limitations
    if (rateLimitReached) {
        logger.warn('⚠️ Data collection incomplete due to GitHub API rate limiting');
    }

    if (totalEvents >= MAX_NUMBER_OF_MOST_RECENT_EVENTS) {
        logger.warn(
            `⚠️ GitHub Events API only returns up to ${MAX_NUMBER_OF_MOST_RECENT_EVENTS} most recent events.`
            + ' Some events may be missing.',
        );
    }

    return {
        events: collectedPages.flat(),
        metadata: {
            totalEvents,
            pagesCollected: collectedPages.length,
            rateLimitReached,
            rateLimitRemaining,
            rateLimitReset: rateLimitReset ? new Date(rateLimitReset * 1000).toISOString() : null,
            timestamp: new Date().toISOString(),
        },
    };
};

/**
 * Get open issues with pagination.
 *
 * @param {object} commonRequestData Common request data for the GitHub API.
 *
 * @returns {Promise<Array<object>>} Array with open issues.
 */
export const getOpenIssues = async (commonRequestData = {}) => {
    const collectedPages = [];

    let currentLink = 'rel="next"';
    let pageNumber = 1;
    while (currentLink && currentLink.includes('rel="next"')) {
        const { headers, data } = await octokit.request(ENDPOINTS.ISSUES, {
            ...commonRequestData,
            state: 'open',
            page: pageNumber,
        });

        collectedPages.push(data);

        currentLink = headers.link;
        pageNumber += 1;
    }

    return collectedPages.flat();
};

const ENDPOINT_ISSUES_LIST = 'GET /repos/{owner}/{repo}/issues';
const ENDPOINT_PULLS_LIST = 'GET /repos/{owner}/{repo}/pulls';

/**
 * Check if a timestamp falls within the specified time window.
 *
 * @param {string} iso ISO 8601 timestamp to check.
 * @param {{start: Date, end: Date}} interval Pre-computed interval with `start` and `end` Date objects.
 *
 * @returns {boolean} True if the timestamp falls within the time window, false otherwise.
 */
const inWindow = (iso, interval) => {
    if (!iso) {
        return false;
    }
    return isWithinInterval(new Date(iso), interval);
};

/**
 * List closed (true) issues whose `closed_at` falls in the time window.
 * Filters out pull-request rows (GitHub's /issues endpoint mixes them in).
 *
 * @param {{owner: string, repo: string}} commonRequestData Common request data for the GitHub API.
 * @param {{since: string, until: string}} timePeriod Time window with ISO 8601 `since` and `until` bounds.
 *
 * @returns {Promise<Array<object>>} Array with closed issues in the time window.
 */
export const getClosedIssuesInWindow = async (commonRequestData, timePeriod) => {
    const { since, until } = timePeriod;
    const sinceDate = new Date(since);
    const interval = { start: sinceDate, end: new Date(until) };
    const collected = [];
    let page = 1;
    let stop = false;
    while (!stop) {
        if (page > MAX_PAGES) {
            logger.warn(`⚠️ Pagination safety limit (${MAX_PAGES} pages) reached for getClosedIssuesInWindow`);
            break;
        }
        const { data, headers } = await octokit.request(ENDPOINT_ISSUES_LIST, {
            ...commonRequestData,
            state: 'closed',
            since,
            sort: 'updated',
            direction: 'desc',
            per_page: 100,
            page,
        });
        for (const row of data) {
            if (row.pull_request) {
                continue;
            }
            // With desc order, once updated_at < since no subsequent issue can
            // have closed_at inside the window (closed_at <= updated_at always).
            // Do NOT short-circuit on updated_at > until: an issue can have
            // closed_at inside the window but updated_at later (e.g. a comment
            // was added after the window closed).
            if (isBefore(new Date(row.updated_at), sinceDate)) {
                stop = true;
                break;
            }
            if (inWindow(row.closed_at, interval)) {
                collected.push(row);
            }
        }
        const link = headers.link || '';
        if (!link.includes('rel="next"') || data.length === 0) {
            stop = true;
        }
        page += 1;
    }
    return collected;
};

/**
 * List pull requests created or merged within the time window.
 * Walks pages newest-first and stops when `updated_at` falls strictly
 * before `since` (no further matches possible).
 *
 * @param {{owner: string, repo: string}} commonRequestData Common request data for the GitHub API.
 * @param {{since: string, until: string}} timePeriod Time window with ISO 8601 `since` and `until` bounds.
 *
 * @returns {Promise<Array<object>>} Array with pull requests in the time window.
 */
export const getPullsInWindow = async (commonRequestData, timePeriod) => {
    const { since, until } = timePeriod;
    const sinceDate = new Date(since);
    const interval = { start: sinceDate, end: new Date(until) };
    const collected = [];
    let page = 1;
    let stop = false;
    while (!stop) {
        if (page > MAX_PAGES) {
            logger.warn(`⚠️ Pagination safety limit (${MAX_PAGES} pages) reached for getPullsInWindow`);
            break;
        }
        const { data, headers } = await octokit.request(ENDPOINT_PULLS_LIST, {
            ...commonRequestData,
            state: 'all',
            sort: 'updated',
            direction: 'desc',
            per_page: 100,
            page,
        });
        for (const pr of data) {
            if (isBefore(new Date(pr.updated_at), sinceDate)) {
                stop = true;
                break;
            }
            const openedIn = inWindow(pr.created_at, interval);
            const mergedIn = pr.merged_at && inWindow(pr.merged_at, interval);
            if (openedIn || mergedIn) {
                collected.push(pr);
            }
        }
        const link = headers.link || '';
        if (!link.includes('rel="next"') || data.length === 0) {
            stop = true;
        }
        page += 1;
    }
    return collected;
};
