import { Octokit } from '@octokit/core';
import { isBefore, isWithinInterval } from 'date-fns';
import { ENDPOINTS, MAX_NUMBER_OF_MOST_RECENT_EVENTS } from '../constants';
import { logger } from './logger';
import {
    RETRY_AFTER_HEADER,
    X_RATE_LIMIT_REMAINING_HEADER,
    isRateLimitError,
    withRetry,
} from './retry-utils';

const { GITHUB_TOKEN } = process.env;

/**
 * Timeout for a single GitHub API request in milliseconds.
 *
 * `node-fetch` has no timeout by default, and its own `timeout` option
 * does not abort a response that stalls after the headers. The timeout is
 * therefore applied as an abort signal created for each request attempt.
 */
const REQUEST_TIMEOUT_MS = 30 * 1000;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

/**
 * Perform a GitHub API request with a timeout that covers the whole attempt.
 *
 * The abort signal is created per call, so a retry gets a fresh timeout
 * and an aborted request, including a stalled response body, is rejected
 * and its socket is closed. `@octokit/request` reports an aborted request
 * as status 500, which `withRetry` treats as transient.
 *
 * @param {string} endpoint Octokit endpoint.
 * @param {object} [params] Request parameters.
 *
 * @returns {Promise<object>} Octokit response.
 */
const requestWithTimeout = (endpoint, params = {}) => octokit.request(endpoint, {
    ...params,
    request: {
        ...params.request,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
});

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
 * Parse the rate limit reset time from response headers.
 *
 * @param {object} headers Response headers.
 *
 * @returns {string|null} ISO 8601 reset time, or `null` when it is absent or invalid.
 */
const parseRateLimitReset = (headers) => {
    const reset = parseInt(headers[X_RATE_LIMIT_RESET_HEADER], 10);

    return Number.isNaN(reset) ? null : new Date(reset * 1000).toISOString();
};

/**
 * Build the error message for a GitHub API rate limit response.
 *
 * GitHub sends the regular `x-ratelimit-*` headers with every response, so
 * `retry-after` is checked first: a secondary limit reports the wait time,
 * while a primary limit reports the reset time when no requests remain.
 *
 * @param {object} headers Headers of the rate limit response.
 *
 * @returns {string} Human-readable rate limit message.
 */
const buildRateLimitMessage = (headers) => {
    const retryAfter = parseInt(headers[RETRY_AFTER_HEADER], 10);

    if (!Number.isNaN(retryAfter)) {
        return `GitHub API rate limit exceeded. Retry in ${retryAfter} seconds`;
    }

    const reset = parseRateLimitReset(headers);

    if (headers[X_RATE_LIMIT_REMAINING_HEADER] === '0' && reset !== null) {
        return `GitHub API rate limit exceeded. Limit will reset at ${reset}`;
    }

    return 'GitHub API rate limit exceeded.';
};

/**
 * Get GitHub events from with pagination.
 *
 * An Events API page request that fails with a transient error is
 * retried three times before the collection fails. A rate limit
 * response is not retried and reports when the limit resets.
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
            const requestParams = { ...commonRequestData, page: pageNumber };
            const { headers, data } = await withRetry(
                () => requestWithTimeout(ENDPOINTS.GITHUB_EVENTS, requestParams),
                { label: `Events API page ${pageNumber}` },
            );

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
        if (isRateLimitError(error)) {
            rateLimitReached = true;
            throw new Error(buildRateLimitMessage(error.response?.headers ?? {}));
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
        const { headers, data } = await requestWithTimeout(ENDPOINTS.ISSUES, {
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
 * Maximum number of commits requested per page when listing commits.
 */
const COMMITS_PER_PAGE = 100;

/**
 * Maximum number of commit pages fetched for one reporting window.
 *
 * The limit guards against a runaway pagination loop. It covers several
 * months of repository activity, and a window that exceeds it fails instead
 * of returning a silently truncated commit list.
 */
const MAX_COMMIT_PAGES = 300;

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
        const { data, headers } = await requestWithTimeout(ENDPOINT_ISSUES_LIST, {
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
        const { data, headers } = await requestWithTimeout(ENDPOINT_PULLS_LIST, {
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

/**
 * List commits added to the default branch whose committer date falls in the time window.
 * Walks pages newest-first until the last page is reached or the safety limit is hit.
 * Commits are deduplicated by SHA.
 *
 * @param {{owner: string, repo: string}} commonRequestData Common request data for the GitHub API.
 * @param {{since: string, until: string}} timePeriod Time window with ISO 8601 `since` and `until` bounds.
 *
 * @returns {Promise<Array<object>>} Array with commits in the time window.
 */
export const getCommitsInWindow = async (commonRequestData, timePeriod) => {
    const { since, until } = timePeriod;
    const sinceDate = new Date(since);
    const untilDate = until ? new Date(until) : new Date();
    const interval = { start: sinceDate, end: untilDate };
    const collected = [];
    const seenShas = new Set();
    let page = 1;
    let stop = false;
    while (!stop) {
        if (page > MAX_COMMIT_PAGES) {
            // Returning a partial list here would be indistinguishable from a
            // complete one, and the caller would drop the PushEvent fallback.
            throw new Error(
                `Commit list for the reporting window exceeds ${MAX_COMMIT_PAGES} pages `
                + `of ${COMMITS_PER_PAGE}. Narrow the window.`,
            );
        }
        const { data, headers } = await requestWithTimeout(ENDPOINTS.COMMITS, {
            ...commonRequestData,
            since: sinceDate.toISOString(),
            until: untilDate.toISOString(),
            per_page: COMMITS_PER_PAGE,
            page,
        });
        for (const commit of data) {
            if (seenShas.has(commit.sha)) {
                continue;
            }
            seenShas.add(commit.sha);
            // GitHub filters commits by committer date, but keep the local
            // check to guarantee the exact window bounds and inclusive edges.
            if (!inWindow(commit.commit?.committer?.date, interval)) {
                continue;
            }
            collected.push(commit);
        }
        const link = headers.link || '';
        if (!link.includes('rel="next"') || data.length === 0) {
            stop = true;
        }
        page += 1;
    }
    return collected;
};
