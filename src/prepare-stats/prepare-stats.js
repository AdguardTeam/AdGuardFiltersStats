import { prepareRepoStat } from './prepare-repo-stat';
import { prepareContributors } from './prepare-contributors';
import { prepareActivityStat } from './prepare-contributors-stat';
import { prepareDetailedActivityStat } from './prepare-detailed-activity-stat';
import { getEventsFromCollection, mergeSyntheticEventsIntoCollection } from '../tools/fs-utils';
import { reconcileWindow } from '../tools/reconcile';

const dedupeById = (events) => {
    const seen = new Set();
    const out = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const e of events) {
        // eslint-disable-next-line no-continue
        if (!e || !e.id || seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
    }
    return out;
};

/**
 * Process all stored events to compose statistics object
 *
 * @param {string} collectionPath path to events collection
 * @param {Object} commonRequestData
 * @param {Object} timePeriod
 * @return {Object}
 */
export const prepareStats = async (collectionPath, commonRequestData, timePeriod) => {
    const liveEvents = await getEventsFromCollection(collectionPath, timePeriod);

    const repoMeta = {
        id: 0,
        name: `${commonRequestData.owner}/${commonRequestData.repo}`,
    };
    const reconciliation = await reconcileWindow(commonRequestData, timePeriod, repoMeta);
    if (reconciliation.error) {
        // eslint-disable-next-line no-console
        console.warn(`⚠️ Reconciliation failed: ${reconciliation.error}. Stats may under-report.`);
    } else if (reconciliation.injectedEvents.length > 0) {
        // Persist so future reports inherit the recovered events
        await mergeSyntheticEventsIntoCollection(collectionPath, reconciliation.injectedEvents);
    }

    const events = dedupeById([...liveEvents, ...reconciliation.injectedEvents]);

    if (events.length === 0 && reconciliation.error) {
        throw new Error(
            `No events available for window ${timePeriod.since}..${timePeriod.until} `
            + `and reconciliation failed: ${reconciliation.error}`,
        );
    }

    const repoStat = await prepareRepoStat(events, commonRequestData, timePeriod);
    const contributors = prepareContributors(events);
    const activityStat = prepareActivityStat(contributors);
    const detailedActivityStat = prepareDetailedActivityStat(contributors);

    return { repoStat, activityStat, ...detailedActivityStat };
};
