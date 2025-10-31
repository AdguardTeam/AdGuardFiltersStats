import { format } from 'date-fns';
import {
    EVENT_TYPES,
    LABEL_NAMES,
    ACTION_NAMES,
} from '../constants';

/**
 * Determines if Github event is 'opened'
 * @param {Object} e github event object
 * @return {boolean}
 */
const isOpenedAction = (e) => e.payload.action === ACTION_NAMES.OPENED;

/**
 * Determines if Github event is 'closed'
 * @param {Object} e github event object
 * @return {boolean}
 */
const isClosedAction = (e) => e.payload.action === ACTION_NAMES.CLOSED;

/**
 * Determines if Github issue has Stale label
 * @param {Object} issue github issue object
 * @return {boolean}
 */
const isStale = (issue) => {
    const { labels } = issue;
    if (!labels || labels.length === 0) {
        return false;
    }
    return labels.some((label) => label.name === LABEL_NAMES.STALE);
};

/**
 * Determines if pull request is merged
 * @param {Object} pull github pull object
 * @return {boolean}
 */
const isMerged = (pull) => {
    const mergeTime = pull.payload.pull_request.merged_at;
    return typeof mergeTime === 'string';
};

/**
 * Checks if GitHub Event object was created since time specified
 *
 * @param {object} event GitHub API response object
 * @param {string} searchTime timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SS
 * @return {boolean}
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
 * Checks if GitHub Event object was created until time specified
 *
 * @param {object} event GitHub API response object
 * @param {string} searchTime timestamp in ISO 8601 format: YYYY-MM-DDTHH:MM:SS
 * @return {boolean}
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
 * Counts commits in given PushEvents
 *
 * @param {Array<Object>} pushEvents array with PushEvents
 * @return {number}
 */
const getCommitsCount = (pushEvents) => {
    const commitsCount = pushEvents.reduce((acc, event) => {
        return acc + (event.payload.commits?.length || 0);
    }, 0);
    return commitsCount;
};

/**
 * Counts events of specified type for contributor
 * @param {Object} contributor contributor events object
 * @param {string} eventType event type as per Github events doc
 * @return {number}
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
            .filter((event) => !isMerged(event))
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
 * Sort events by date of creation
 * @param {Array<Object>} events
 * @return {Object<Array<Object>>}
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
 * Modify events array so index reflects events create hour
 * @param {Array} events
 * @return {Array<Array<number>>} hourly activity array
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
 * Sort events of given contributor by YYYY-MM-DD date and then by hour
 * @param {Object} contributor contributor events object
 * @return {Object}
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
    // eslint-disable-next-line no-restricted-syntax
    for (const [name, events] of Object.entries(sortedEvents)) {
        sortedEvents[name] = sortEventsByHour(events);
    }

    return sortedEvents;
};

/**
 * Checks if event counts as activity and returns corresponding contributor
 * @param {Object} events array with GitHub event objects
 * @return {string|undefined} returns author name for activities and undefined for other events
 */
const getActivityAuthor = (event) => {
    const { type, payload, actor } = event;
    const username = actor.login;
    let contributorName;
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
