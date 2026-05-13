import { prepareRepoStat } from './prepare-repo-stat';
import { prepareContributors } from './prepare-contributors';
import { prepareActivityStat } from './prepare-contributors-stat';
import { prepareDetailedActivityStat } from './prepare-detailed-activity-stat';
import { getEventsFromCollection, mergeSyntheticEventsIntoCollection } from '../tools/fs-utils';
import { reconcileWindow } from '../tools/reconcile';
import { logger } from '../tools/logger';

const dedupeById = (events) => {
    const seen = new Set();
    const out = [];
    for (const e of events) {
        if (!e || !e.id || seen.has(e.id)) {
            continue;
        }
        seen.add(e.id);
        out.push(e);
    }
    return out;
};

/**
 * Process all stored events to compose statistics object.
 *
 * @param {string} collectionPath Path to events collection.
 * @param {object} commonRequestData Object with `owner` and `repo` strings.
 * @param {object} timePeriod Object with `since` and `until` ISO date strings.
 *
 * @returns {object} Statistics object.
 */
export const prepareStats = async (collectionPath, commonRequestData, timePeriod) => {
    const liveEvents = await getEventsFromCollection(collectionPath, timePeriod);

    const repoMeta = {
        id: 0,
        name: `${commonRequestData.owner}/${commonRequestData.repo}`,
    };

    let injectedEvents = [];
    let reconcileError = null;
    if (process.env.RECONCILE === 'true') {
        const reconciliation = await reconcileWindow(commonRequestData, timePeriod, repoMeta);
        if (reconciliation.error) {
            reconcileError = reconciliation.error;
            logger.warn(`⚠️ Reconciliation failed: ${reconciliation.error}. Stats may under-report.`);
        } else {
            injectedEvents = reconciliation.injectedEvents;
            if (injectedEvents.length > 0) {
                // Persist so future reports inherit the recovered events
                await mergeSyntheticEventsIntoCollection(collectionPath, injectedEvents);
            }
        }
    }

    const events = dedupeById([...liveEvents, ...injectedEvents]);

    if (events.length === 0 && reconcileError) {
        throw new Error(
            `No events available for window ${timePeriod.since}..${timePeriod.until} `
            + `and reconciliation failed: ${reconcileError}`,
        );
    }

    const repoStat = await prepareRepoStat(events, commonRequestData, timePeriod);
    const contributors = prepareContributors(events);
    const activityStat = prepareActivityStat(contributors);
    const detailedActivityStat = prepareDetailedActivityStat(contributors);

    return { repoStat, activityStat, ...detailedActivityStat };
};
