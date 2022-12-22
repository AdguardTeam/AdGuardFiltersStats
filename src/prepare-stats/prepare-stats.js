import { prepareRepoStat } from './prepare-repo-stat';
import { prepareContributors } from './prepare-contributors';
import { prepareActivityStat } from './prepare-contributors-stat';
import { prepareDetailedActivityStat } from './prepare-detailed-activity-stat';
import { getEventsFromCollection } from '../tools/fs-utils';

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

    console.log(eventsFromPeriod);

    const repoStat = await prepareRepoStat(eventsFromPeriod, commonRequestData, timePeriod);

    console.log(repoStat);

    const contributors = prepareContributors(eventsFromPeriod);
    const activityStat = prepareActivityStat(contributors);
    const detailedActivityStat = prepareDetailedActivityStat(contributors);

    console.log(contributors);
    console.log(activityStat);
    console.log(detailedActivityStat);

    return {
        repoStat,
        activityStat,
        ...detailedActivityStat,
    };
};
