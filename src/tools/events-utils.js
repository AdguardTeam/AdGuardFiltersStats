import { format } from 'date-fns';
import {
    EVENT_TYPES,
    LABEL_NAMES,
    ACTION_NAMES,
    EXCLUDED_USERNAMES,
} from '../constants';

/**
 * Determines if Github event is 'opened'.
 *
 * @param {object} e GitHub event object.
 *
 * @returns {boolean} True if event action is opened.
 */
const isOpenedAction = (e) => e.payload.action === ACTION_NAMES.OPENED;

/**
 * Determines if Github event is 'closed'.
 *
 * @param {object} e GitHub event object.
 *
 * @returns {boolean} True if event action is closed.
 */
const isClosedAction = (e) => e.payload.action === ACTION_NAMES.CLOSED;

/**
 * Determines if Github issue has Stale label.
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
 * Determines if pull request is merged.
 *
 * @param {object} pull GitHub pull request event object.
 *
 * @returns {boolean} True if the pull request has been merged.
 */
const isMerged = (pull) => {
    const mergeTime = pull.payload.pull_request.merged_at;
    return typeof mergeTime === 'string';
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
 * Modify events array so index reflects events create hour.
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
        case EVENT_TYPES.PULL_REQUEST_REVIEW_EVENT:
        case EVENT_TYPES.ISSUE_COMMENT_EVENT:
        case EVENT_TYPES.PUSH_EVENT: {
            contributorName = username;
            break;
        }
        case EVENT_TYPES.ISSUES_EVENT: {
            if (payload.action === ACTION_NAMES.CLOSED && !isStale(payload.issue)) {
                contributorName = username;
            }
            break;
        }
        case EVENT_TYPES.PULL_REQUEST_EVENT: {
            // count only newly opened & merged pulls
            if (payload.action === ACTION_NAMES.OPENED
                || (payload.action === ACTION_NAMES.CLOSED && typeof payload.pull_request.merged_at === 'string')) {
                // merged pull request count for the one who opened it.
                // note: user may be deleted, so contributorName may be undefined
                contributorName = payload.pull_request.user?.login;
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
    isMerged,
    isCreatedSince,
    isCreatedUntil,
    getCommitsCount,
    countEventsByType,
    eventsToActivityByTime,
    sortEventsByDate,
    getActivityAuthor,
};
