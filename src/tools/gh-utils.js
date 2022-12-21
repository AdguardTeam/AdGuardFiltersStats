import { Octokit } from '@octokit/core';
import { ENDPOINTS } from '../constants';

const { GITHUB_TOKEN } = process.env;

const octokit = new Octokit({ auth: GITHUB_TOKEN });

/**
 * Get GitHub events from with pagination
 * @return {Promise<Array<Object>>} array with GitHub event objects
 */
export const getGithubEvents = async (commonRequestData = {}) => {
    const collectedPages = [];

    let currentLink = 'rel="next"';
    let pageNumber = 1;
    while (currentLink && currentLink.includes('rel="next"')) {
        // eslint-disable-next-line no-await-in-loop
        const { headers, data } = await octokit.request(ENDPOINTS.GITHUB_EVENTS, {
            ...commonRequestData,
            page: pageNumber,
        });

        collectedPages.push(data);

        currentLink = headers.link;
        pageNumber += 1;
    }

    return collectedPages.flat();
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
