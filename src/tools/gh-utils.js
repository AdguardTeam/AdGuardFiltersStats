import { Octokit } from '@octokit/core';
import { ENDPOINTS, MAX_NUMBER_OF_MOST_RECENT_EVENTS } from '../constants.js';

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
 * Number of events per page.
 *
 * GitHub Events API typically returns 30 events per page.
 *
 * @see {@link https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api?apiVersion=2022-11-28#about-pagination}
 */
const NUMBER_OF_EVENTS_PER_PAGE = 30;

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

            // If we get fewer events than expected,
            // we might have reached the end of available events
            if (data.length < NUMBER_OF_EVENTS_PER_PAGE) {
                break;
            }
        }
    } catch (error) {
        if (error.status === 403 && error.response?.headers?.[X_RATE_LIMIT_REMAINING_HEADER] === '0') {
            rateLimitReached = true;
            rateLimitReset = parseInt(error.response.headers[X_RATE_LIMIT_RESET_HEADER], 10);
            // eslint-disable-next-line no-console
            console.error(`GitHub API rate limit exceeded. Limit will reset at ${new Date(rateLimitReset * 1000).toISOString()}`);
        } else {
            // eslint-disable-next-line no-console
            console.error('Error fetching GitHub events:', error.message);
        }
        // We still return the data we've collected so far
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
