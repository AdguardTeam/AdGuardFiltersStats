import { getOpenIssues } from '../tools/gh-utils';
import {
    isStale,
    isMerged,
    isClosedAction,
    isOpenedAction,
} from '../tools/events-utils';
import { EVENT_TYPES, STALE_BOT_USERNAMES } from '../constants';

/**
 * Determines if an issue close event was performed by the stale bot.
 *
 * @param {object} e GitHub event object.
 *
 * @returns {boolean} True if the event actor is a stale bot username.
 */
const isStaleBotClose = (e) => STALE_BOT_USERNAMES.includes(e.actor.login);

/**
 * Prepare general repo stats.
 *
 * @param {Array<object>} events Array of GitHub events objects.
 * @param {object} commonRequestData GitHub API request parameters.
 * @param {object} timePeriod Time period with since and until.
 *
 * @returns {Promise<object>} General repository statistics.
 */
export const prepareRepoStat = async (events, commonRequestData, timePeriod) => {
    const issuesEvents = events.filter((e) => e.type === EVENT_TYPES.ISSUES_EVENT);
    const newIssueEvents = issuesEvents.filter((e) => isOpenedAction(e));
    // An issue is resolved when it is closed by anyone other than the stale
    // bot — including stale-labelled issues closed manually by maintainers.
    const resolvedIssueEvents = issuesEvents
        .filter((e) => isClosedAction(e) && !isStaleBotClose(e));
    // Only closes performed by the stale bot itself count as "closed as stale".
    const closedAsStaleIssueEvents = issuesEvents
        .filter((e) => isClosedAction(e) && isStale(e.payload.issue) && isStaleBotClose(e));

    const pullsEvents = events.filter((e) => e.type === EVENT_TYPES.PULL_REQUEST_EVENT);
    const newPullEvents = pullsEvents.filter((e) => isOpenedAction(e));
    const mergedPullEvents = pullsEvents.filter((e) => isMerged(e));

    /* Compose general repository statistics */
    const openIssues = await getOpenIssues(commonRequestData);

    // Remove pull requests from issues
    const remainingIssues = openIssues.filter((issue) => {
        return !issue.pull_request;
    });

    const generalStat = {
        timePeriod,
        newIssues: newIssueEvents.length,
        resolvedIssues: resolvedIssueEvents.length,
        closedAsStaleIssues: closedAsStaleIssueEvents.length,
        newPulls: newPullEvents.length,
        mergedPulls: mergedPullEvents.length,
        remainingIssues: remainingIssues.length,
    };

    return generalStat;
};
