import { prepareRepoStat } from './prepare-repo-stat';
import { prepareContributors } from './prepare-contributors';
import { prepareActivityStat } from './prepare-contributors-stat';
import { prepareDetailedActivityStat } from './prepare-detailed-activity-stat';
import { getEventsFromCollection, mergeSyntheticEventsIntoCollection } from '../tools/fs-utils';
import { reconcileWindow } from '../tools/reconcile';
import { getCommitsInWindow } from '../tools/gh-utils';
import { buildCommitEvents } from '../tools/commit-events';
import { logger } from '../tools/logger';
import { EVENT_TYPES } from '../constants';

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
 * Fetch commits for the reporting window and convert them into synthetic events.
 *
 * PushEvent payloads no longer carry the commits list, and the Events API
 * returns at most the 300 most recent events, so the commit activity cannot be
 * derived from the stored events. The REST commits endpoint is the source of
 * truth for the window.
 *
 * @param {object} commonRequestData Object with `owner` and `repo` strings.
 * @param {object} timePeriod Object with `since` and `until` ISO date strings.
 * @param {object} repoMeta Repository metadata object with `id` and `name` fields.
 *
 * @returns {Promise<Array<object>|null>} Synthetic PushEvents, or null when the
 * window has no lower bound or the request fails.
 */
const fetchCommitEvents = async (commonRequestData, timePeriod, repoMeta) => {
    if (!timePeriod.since) {
        return null;
    }
    let commits;
    try {
        commits = await getCommitsInWindow(commonRequestData, timePeriod);
    } catch (error) {
        logger.warn(
            `⚠️ Failed to fetch commits for the reporting window: ${error.message}.`
            + ' Falling back to PushEvent counts; commit statistics may be incomplete.',
            error,
        );
        return null;
    }
    // Conversion errors are not fetch errors: let them surface instead of
    // silently switching the report to the fallback.
    const commitEvents = buildCommitEvents(commits, repoMeta);
    const skipped = commits.length - commitEvents.length;
    if (skipped > 0) {
        logger.warn(
            `⚠️ Skipped ${skipped} of ${commits.length} commits without a linked GitHub author`
            + ' or committer date; commit statistics may be incomplete.',
        );
    }
    // When nothing can be attributed, the REST list carries no usable data.
    // Keep the PushEvent fallback instead of reporting zero commits.
    if (commits.length > 0 && commitEvents.length === 0) {
        logger.warn('⚠️ No fetched commit could be attributed; falling back to PushEvent counts.');
        return null;
    }
    return commitEvents;
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

    const commitEvents = await fetchCommitEvents(commonRequestData, timePeriod, repoMeta);
    const commitsAreAuthoritative = commitEvents !== null;
    // When the REST commit list is available it replaces PushEvents entirely:
    // a stored PushEvent carries no commit details and counts as one commit
    // for the pusher, even when several authors contributed to the push.
    const storedEvents = commitsAreAuthoritative
        ? [...liveEvents, ...injectedEvents].filter((e) => e.type !== EVENT_TYPES.PUSH_EVENT)
        : [...liveEvents, ...injectedEvents];
    const events = dedupeById([...storedEvents, ...(commitEvents || [])]);

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
