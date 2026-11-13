import { format } from 'date-fns';
import {
    EVENT_TYPES,
    LABEL_NAMES,
    ACTION_NAMES,
    DECISION_REVIEW_STATES,
    EXCLUDED_USERNAMES,
} from '../constants';

/**
 * Determines if GitHub event is 'opened'.
 *
 * @param {object} e GitHub event object.
 *
 * @returns {boolean} True if event action is opened.
 */
const isOpenedAction = (e) => e.payload.action === ACTION_NAMES.OPENED;

/**
 * Determines if GitHub event is 'closed'.
 *
 * @param {object} e GitHub event object.
 *
 * @returns {boolean} True if event action is closed.
 */
const isClosedAction = (e) => e.payload.action === ACTION_NAMES.CLOSED;

/**
 * Determines if GitHub issue has Stale label.
 *
 * @param {object} issue GitHub issue object.
 *
 * @returns {boolean} True if issue has a stale label.
 */
const isStale = (issue) => {
    const { labels } = issue;
    if (!labels || labels.length === 0) {
        return false;
    }
    return labels.some((label) => label.name === LABEL_NAMES.STALE);
};

/**
 * Determines if the event actor is a stale bot.
 *
 * The stale bots are the same accounts that are excluded from the
 * statistics via EXCLUDED_USERNAMES — keeping a single list makes the
 * repo-level "Closed as stale" metric and the contributor-level
 * resolution counter stay consistent.
 *
 * @param {object} e GitHub event object.
 *
 * @returns {boolean} True if the event actor is a stale bot username.
 */
const isStaleBotActor = (e) => EXCLUDED_USERNAMES.includes(e.actor?.login);

/**
 * Determines if an issue close event counts as "closed as stale".
 *
 * A close counts as stale only when the stale bot closed a stale-labelled
 * issue. Every other close — including stale-labelled issues closed
 * manually by maintainers and bot closes of non-stale issues — is a
 * regular resolution, so this predicate and its negation partition all
 * close events.
 *
 * @param {object} e GitHub event object.
 *
 * @returns {boolean} True if the event is a stale bot close of a stale issue.
 */
const isClosedAsStale = (e) => isStale(e.payload.issue) && isStaleBotActor(e);

/**
 * Determines if pull request is merged.
 *
 * The Events API reports merged pull requests with action `merged`, and a
 * reduced `pull_request` object that has no `merged_at` field. Older events
 * report `action: closed` with `merged_at` set; both forms must count.
 *
 * @param {object} event GitHub pull request event object.
 *
 * @returns {boolean} True if the pull request has been merged.
 */
const isMerged = (event) => {
    if (event.payload.action === ACTION_NAMES.MERGED) {
        return true;
    }
    const mergeTime = event.payload.pull_request?.merged_at;
    return typeof mergeTime === 'string';
};

/**
 * Determines if a pull request review event is a review decision.
 *
 * The Events API sends a `created` event for a submitted review and an
 * `updated` event when a review is edited. An edit does not add a review,
 * so only `created` reviews with a decision state count as activity.
 *
 * @param {object} event GitHub pull request review event object.
 *
 * @returns {boolean} True if the event is a submitted review with a decision.
 */
const isDecisionReview = (event) => {
    const { action, review } = event.payload;
    return action === ACTION_NAMES.CREATED
        && DECISION_REVIEW_STATES.includes(review?.state);
};

/**
 * Checks if GitHub Event object was created since time specified.
 *
 * @param {object} event GitHub API response object.
 * @param {string} searchTime Timestamp in ISO 8601 format.
 *
 * @returns {boolean} True if event was created at or after searchTime.
 */
const isCreatedSince = (event, searchTime) => {
    if (!searchTime) {
        return true;
    }
    const createdAt = event.created_at;
    const searchTimeNum = new Date(searchTime).getTime();
    const createTimeNum = new Date(createdAt).getTime();

    return searchTimeNum <= createTimeNum;
};

/**
 * Checks if GitHub Event object was created until time specified.
 *
 * @param {object} event GitHub API response object.
 * @param {string} searchTime Timestamp in ISO 8601 format.
 *
 * @returns {boolean} True if event was created at or before searchTime.
 */
const isCreatedUntil = (event, searchTime) => {
    if (!searchTime) {
        return true;
    }
    const createdAt = event.created_at;
    const searchTimeNum = new Date(searchTime).getTime();
    const createTimeNum = new Date(createdAt).getTime();

    return searchTimeNum >= createTimeNum;
};

/**
 * Counts commits in given PushEvents.
 *
 * @param {Array<object>} pushEvents Array with PushEvents.
 *
 * @returns {number} Total number of commits.
 */
const getCommitsCount = (pushEvents) => {
    const commitsCount = pushEvents.reduce((acc, event) => {
        const commitsInPush = event.payload.commits?.length;
        // If commits array exists but is empty, or doesn't exist at all,
        // assume 1 commit per push as a reasonable fallback
        return acc + (commitsInPush || 1);
    }, 0);
    return commitsCount;
};

/**
 * Counts events of specified type for contributor.
 *
 * @param {object} contributor Contributor events object.
 * @param {string} eventType Event type as per GitHub events doc.
 *
 * @returns {number} Count of events of the specified type.
 */
const countEventsByType = (contributor, eventType) => {
    if (eventType === EVENT_TYPES.NEW_PULL_EVENT
        && contributor.events[EVENT_TYPES.PULL_REQUEST_EVENT]) {
        const newPullsCount = contributor
            .events
            .PullRequestEvent
            .filter((event) => !isMerged(event))
            .length;
        return newPullsCount;
    }
    if (eventType === EVENT_TYPES.MERGED_PULL_EVENT
        && contributor.events[EVENT_TYPES.PULL_REQUEST_EVENT]) {
        const mergedPullsCount = contributor
            .events
            .PullRequestEvent
            .filter((event) => isMerged(event))
            .length;
        return mergedPullsCount;
    }
    if (!contributor.events[eventType]) {
        return 0;
    }
    if (eventType === EVENT_TYPES.PUSH_EVENT) {
        return getCommitsCount(contributor.events.PushEvent);
    }

    return contributor.events[eventType].length;
};

/**
 * Sort events by date of creation.
 *
 * @param {Array<object>} events Array of GitHub events.
 *
 * @returns {object} Events grouped by YYYY-MM-DD date.
 */
const sortEventsByDate = (events) => {
    const sortedEvents = {};
    events.forEach((event) => {
        const createTime = format(new Date(event.created_at), 'yyy-MM-dd');
        if (!sortedEvents[createTime]) {
            sortedEvents[createTime] = [];
        }
        sortedEvents[createTime].push(event);
    });

    return sortedEvents;
};

/**
 * Modify events array so index reflects events creation hour.
 *
 * @param {Array<object>} events Array of GitHub events.
 *
 * @returns {Array<number>} Hourly activity counts.
 */
const sortEventsByHour = (events) => {
    const eventsByHour = [];
    for (let i = 0; i <= 23; i += 1) {
        eventsByHour[i] = [];
    }

    // Sort events by their creation hour
    events.forEach((event) => {
        const createdAt = event.created_at;
        const hour = new Date(createdAt).getHours();
        eventsByHour[hour].push(event);
    });

    // Modify events into activities by collapsing event subarrays into their length
    return eventsByHour.map((hourEvents) => hourEvents.length);
};

/**
 * Sort events of given contributor by YYYY-MM-DD date and then by hour.
 *
 * @param {object} contributor Contributor events object.
 *
 * @returns {object} Events sorted by date, then by hour.
 */
const eventsToActivityByTime = (contributor) => {
    const allEvents = Object.values(contributor.events).flat();
    const sortedEvents = {};
    // Sort contributor's events by date
    allEvents.forEach((event) => {
        const createTime = format(new Date(event.created_at), 'yyy-MM-dd');
        if (!sortedEvents[createTime]) {
            sortedEvents[createTime] = [];
        }
        sortedEvents[createTime].push(event);
    });

    // Sort daily arrays by hour
    for (const [name, events] of Object.entries(sortedEvents)) {
        sortedEvents[name] = sortEventsByHour(events);
    }

    return sortedEvents;
};

/**
 * Build an identity key for activity that reconciliation can recover from REST.
 *
 * Live Events-API events and synthetic reconciliation events describe the same
 * activity but have different `id` values, so `dedupeById` cannot collapse
 * them. The key is built from the underlying issue or pull request and the
 * action that counts as activity.
 *
 * An issue can be closed more than once: reopened and closed again. The close
 * time tells those closures apart, so the key keeps the second closure instead
 * of collapsing it into the first one. A payload without `closed_at` falls
 * back to the issue-only key.
 *
 * @param {object} event GitHub event object.
 *
 * @returns {string|null} Activity key, or null when the event is not recoverable activity.
 */
const getActivityKey = (event) => {
    const { type, payload } = event;
    if (type === EVENT_TYPES.ISSUES_EVENT && payload.action === ACTION_NAMES.CLOSED) {
        const issueId = payload.issue?.id;
        if (!issueId) {
            return null;
        }
        const closedAt = payload.issue.closed_at;
        return closedAt ? `issue-${issueId}-closed-${closedAt}` : `issue-${issueId}-closed`;
    }
    if (type === EVENT_TYPES.PULL_REQUEST_EVENT) {
        const pullId = payload.pull_request?.id;
        if (!pullId) {
            return null;
        }
        if (payload.action === ACTION_NAMES.OPENED) {
            return `pr-${pullId}-opened`;
        }
        if (isMerged(event)) {
            return `pr-${pullId}-merged`;
        }
    }
    return null;
};

/**
 * Checks if event counts as activity and returns corresponding contributor.
 *
 * @param {object} event GitHub event object.
 *
 * @returns {string|undefined} Author name for activities, undefined otherwise.
 */
const getActivityAuthor = (event) => {
    const { type, payload, actor } = event;
    const username = actor.login;
    let contributorName = null;
    switch (type) {
        case EVENT_TYPES.PULL_REQUEST_REVIEW_EVENT: {
            // Count submitted reviews with a decision. Edits of an existing
            // review are not a new review, so they do not count.
            if (isDecisionReview(event)) {
                contributorName = username;
            }
            break;
        }
        case EVENT_TYPES.ISSUE_COMMENT_EVENT:
        case EVENT_TYPES.PUSH_EVENT: {
            contributorName = username;
            break;
        }
        case EVENT_TYPES.ISSUES_EVENT: {
            // any close counts as resolution activity, including closes
            // of stale-labelled issues (stale bot closes are filtered out
            // via EXCLUDED_USERNAMES below)
            if (payload.action === ACTION_NAMES.CLOSED) {
                contributorName = username;
            }
            break;
        }
        case EVENT_TYPES.PULL_REQUEST_EVENT: {
            // count only newly opened & merged pulls
            if (payload.action === ACTION_NAMES.OPENED || isMerged(event)) {
                // Count the pull request for the one who opened it. The Events
                // API can reduce `pull_request` to url/id/number/head/base, so
                // the author is often absent. The actor is the user who opened
                // or merged the pull request and is the best available fallback.
                contributorName = payload.pull_request.user?.login || username;
            }
            break;
        }
        default:
            break;
    }

    if (contributorName && EXCLUDED_USERNAMES.includes(contributorName)) {
        return null;
    }

    return contributorName;
};

export {
    isOpenedAction,
    isClosedAction,
    isStale,
    isStaleBotActor,
    isClosedAsStale,
    isMerged,
    isDecisionReview,
    isCreatedSince,
    isCreatedUntil,
    getCommitsCount,
    countEventsByType,
    eventsToActivityByTime,
    sortEventsByDate,
    getActivityKey,
    getActivityAuthor,
};
