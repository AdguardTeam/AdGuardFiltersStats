import { Octokit } from '@octokit/core';
import { ENDPOINTS, MAX_NUMBER_OF_MOST_RECENT_EVENTS } from '../constants';

const { GITHUB_TOKEN } = process.env;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

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
 * @param {Object} commonRequestData Common request data for GitHub API
 *
 * @return {Promise<Object>} Object containing events array and metadata
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
            // eslint-disable-next-line no-await-in-loop
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
                // eslint-disable-next-line no-console
                console.warn(`GitHub API rate limit nearly reached. ${rateLimitRemaining} requests remaining.`);
                // eslint-disable-next-line no-console
                console.warn(`Rate limit will reset at ${new Date(rateLimitReset * 1000).toISOString()}`);
                rateLimitReached = true;
                break;
            }
        }
    } catch (error) {
        if (error.status === 403 && error.response?.headers?.[X_RATE_LIMIT_REMAINING_HEADER] === '0') {
            rateLimitReached = true;
            rateLimitReset = parseInt(error.response.headers[X_RATE_LIMIT_RESET_HEADER], 10);
            throw new Error(`GitHub API rate limit exceeded. Limit will reset at ${new Date(rateLimitReset * 1000).toISOString()}`);
        } else {
            throw new Error('Error fetching GitHub events:', error.message);
        }
    }

    // Log information about the collection
    // eslint-disable-next-line no-console
    console.log(`Collected ${totalEvents} events across ${collectedPages.length} pages`);

    // Notify if we hit API limitations
    if (rateLimitReached) {
        // eslint-disable-next-line no-console
        console.warn('⚠️ Data collection incomplete due to GitHub API rate limiting');
    }

    if (totalEvents >= MAX_NUMBER_OF_MOST_RECENT_EVENTS) {
        // eslint-disable-next-line no-console
        console.warn(`⚠️ GitHub Events API only returns up to ${MAX_NUMBER_OF_MOST_RECENT_EVENTS} most recent events. Some events may be missing.`);
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
 * Get open issues with pagination
 * @return {Promise<Array<Object>>} array with open issues
 */
export const getOpenIssues = async (commonRequestData = {}) => {
    const collectedPages = [];

    let currentLink = 'rel="next"';
    let pageNumber = 1;
    while (currentLink && currentLink.includes('rel="next"')) {
        // eslint-disable-next-line no-await-in-loop
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

const inWindow = (iso, since, until) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= new Date(since).getTime() && t <= new Date(until).getTime();
};

/**
 * List closed (true) issues whose `closed_at` falls in the time window.
 * Filters out pull-request rows (GitHub's /issues endpoint mixes them in).
 *
 * @param {{owner: string, repo: string}} commonRequestData
 * @param {{since: string, until: string}} timePeriod
 * @returns {Promise<Array<Object>>}
 */
export const getClosedIssuesInWindow = async (commonRequestData, timePeriod) => {
    const { since, until } = timePeriod;
    const collected = [];
    let page = 1;
    let stop = false;
    while (!stop) {
        // eslint-disable-next-line no-await-in-loop
        const { data, headers } = await octokit.request(ENDPOINT_ISSUES_LIST, {
            ...commonRequestData,
            state: 'closed',
            since,
            sort: 'updated',
            direction: 'asc',
            per_page: 100,
            page,
        });
        // eslint-disable-next-line no-restricted-syntax
        for (const row of data) {
            // eslint-disable-next-line no-continue
            if (row.pull_request) continue;
            if (inWindow(row.closed_at, since, until)) collected.push(row);
        }
        const link = headers.link || '';
        if (!link.includes('rel="next"') || data.length === 0) stop = true;
        page += 1;
    }
    return collected;
};

/**
 * List pull requests created or merged within the time window.
 * Walks pages newest-first and stops when `updated_at` falls strictly
 * before `since` (no further matches possible).
 */
export const getPullsInWindow = async (commonRequestData, timePeriod) => {
    const { since, until } = timePeriod;
    const sinceMs = new Date(since).getTime();
    const collected = [];
    let page = 1;
    let stop = false;
    while (!stop) {
        // eslint-disable-next-line no-await-in-loop
        const { data, headers } = await octokit.request(ENDPOINT_PULLS_LIST, {
            ...commonRequestData,
            state: 'all',
            sort: 'updated',
            direction: 'desc',
            per_page: 100,
            page,
        });
        // eslint-disable-next-line no-restricted-syntax
        for (const pr of data) {
            const updatedMs = new Date(pr.updated_at).getTime();
            if (updatedMs < sinceMs) {
                stop = true;
                // eslint-disable-next-line no-continue
                continue;
            }
            const openedIn = inWindow(pr.created_at, since, until);
            const mergedIn = pr.merged_at && inWindow(pr.merged_at, since, until);
            if (openedIn || mergedIn) collected.push(pr);
        }
        const link = headers.link || '';
        if (!link.includes('rel="next"') || data.length === 0) stop = true;
        page += 1;
    }
    return collected;
};
