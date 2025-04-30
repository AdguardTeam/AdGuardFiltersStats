import { prepareRepoStat } from './prepare-repo-stat.js';
import { prepareContributors } from './prepare-contributors.js';
import { prepareActivityStat } from './prepare-contributors-stat.js';
import { prepareDetailedActivityStat } from './prepare-detailed-activity-stat.js';
import { getEventsFromCollection } from '../tools/fs-utils.js';

/**
 * Process all stored events to compose statistics object
 *
 * @param {string} collectionPath path to events collection
 * @param {Object} commonRequestData
 * @param {string} searchTime timestamp from which to get events
 * @return {Object}
 */
export const prepareStats = async (collectionPath, commonRequestData, timePeriod) => {
    const eventsFromPeriod = await getEventsFromCollection(collectionPath, timePeriod);

    const repoStat = await prepareRepoStat(eventsFromPeriod, commonRequestData, timePeriod);

    const contributors = prepareContributors(eventsFromPeriod);
    const activityStat = prepareActivityStat(contributors);
    const detailedActivityStat = prepareDetailedActivityStat(contributors);

    return {
        repoStat,
        activityStat,
        ...detailedActivityStat,
    };
};
