import { getCommitsCount } from '../tools/events-utils.js';
import { EVENT_TYPES } from '../constants.js';

export class Contributor {
    constructor() {
        this.events = {};
    }

    addActivityEvent(event) {
        const { type } = event;
        if (!this.events[type]) {
            // Init event type if there is no such type already
            this.events[type] = [];
        }
        this.events[type].push(event);
    }

    countTotalActivity() {
        let activityCount = 0;
        // eslint-disable-next-line no-restricted-syntax
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
