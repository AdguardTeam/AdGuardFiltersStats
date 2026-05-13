import { getCommitsCount } from '../tools/events-utils';
import { EVENT_TYPES } from '../constants';

/**
 * Represents a contributor and their activity events.
 */
export class Contributor {
    /**
     * Creates a new Contributor instance with empty events.
     */
    constructor() {
        this.events = {};
    }

    /**
     * Adds an activity event to the contributor's event collection.
     *
     * @param {object} event GitHub event object.
     */
    addActivityEvent(event) {
        const { type } = event;
        if (!this.events[type]) {
            // Init event type if there is no such type already
            this.events[type] = [];
        }
        this.events[type].push(event);
    }

    /**
     * Counts total activity across all event types.
     *
     * @returns {number} Total activity count.
     */
    countTotalActivity() {
        let activityCount = 0;
        for (const eventType of Object.keys(this.events)) {
            if (eventType === EVENT_TYPES.PUSH_EVENT) {
                // Extract commits from PushEvents to count them separately
                const commitsCount = getCommitsCount(this.events[eventType]);
                activityCount += commitsCount;
            } else {
                activityCount += this.events[eventType].length;
            }
        }
        return activityCount;
    }
}
