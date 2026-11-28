import { prepareRepoStat } from './prepare-repo-stat';
import { prepareContributors } from './prepare-contributors';
import { prepareActivityStat } from './prepare-contributors-stat';
import { prepareDetailedActivityStat } from './prepare-detailed-activity-stat';
import { getEventsFromCollection, mergeSyntheticEventsIntoCollection } from '../tools/fs-utils';
import { reconcileWindow } from '../tools/reconcile';
import { getCommitsInWindow } from '../tools/gh-utils';
import { buildCommitEvents } from '../tools/commit-events';
import { getActivityKey } from '../tools/events-utils';
import { logger } from '../tools/logger';
import { describeError, normalizeErrorMessage } from '../tools/error-utils';
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
        // The commits endpoint needs a lower bound. Without it, the report
        // falls back to one commit per stored PushEvent, which under-reports
        // a push with several authors. Warn, so the fallback is visible.
        logger.warn(
            '⚠️ SINCE is not set, so the commits request is skipped. '
            + 'Commit statistics fall back to one per stored PushEvent.',
        );
        return null;
    }
    let commits;
    try {
        commits = await getCommitsInWindow(commonRequestData, timePeriod);
    } catch (error) {
        // Keep the status next to the message, as the retry warning does: a
        // 401 and a 503 are different problems with the same kind of text.
        // `describeError` also names the failure when the response body is
        // empty, instead of leaving the warning with no reason.
        const status = typeof error?.status === 'number' ? error.status : 'no status';
        logger.warn(
            `⚠️ Failed to fetch commits for the reporting window (${status}): `
            + `${describeError(error)}.`
            + ' Falling back to PushEvent counts; commit statistics may be incomplete.',
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
    let reconcileTruncated = false;
    if (process.env.RECONCILE === 'true' && !timePeriod.since) {
        // Reconciliation needs a lower bound: without one its walks would
        // scan the whole history, and the report itself already covers every
        // stored day.
        logger.warn('⚠️ RECONCILE is ignored without SINCE: reconciliation needs a reporting window.');
    }
    if (process.env.RECONCILE === 'true' && timePeriod.since) {
        const reconciliation = await reconcileWindow(commonRequestData, timePeriod, repoMeta);
        injectedEvents = reconciliation.injectedEvents;
        reconcileError = reconciliation.error;
        reconcileTruncated = reconciliation.truncated;
        if (reconcileError) {
            logger.warn(`⚠️ Reconciliation failed: ${reconcileError}. Stats may under-report.`);
        }
        if (reconcileTruncated) {
            logger.warn('⚠️ Reconciliation stopped before it covered the window. Stats may under-report.');
        }
        // A failed walk loses only its own data: use and persist what the
        // other walk recovered. The activity-key filter below still counts
        // each recovered activity once, also when a retry returns it again.
        // Persistence is best effort: the report already holds the events, so
        // a write failure must not fail the command.
        if (injectedEvents.length > 0) {
            try {
                await mergeSyntheticEventsIntoCollection(collectionPath, injectedEvents);
            } catch (mergeError) {
                logger.warn(
                    `⚠️ Failed to store the recovered events: ${normalizeErrorMessage(mergeError)}.`
                    + ' The report still uses them; the next run fetches them again.',
                );
            }
        }
    }

    const commitEvents = await fetchCommitEvents(commonRequestData, timePeriod, repoMeta);
    const commitsAreAuthoritative = commitEvents !== null;
    // Injected events carry the author from the REST API, while live events
    // may have a reduced payload. Prefer the injected copy so the same
    // activity is counted once and attributed to the pull request author.
    const injectedActivityKeys = new Set(injectedEvents.map(getActivityKey).filter(Boolean));
    const liveEventsWithoutSuperseded = liveEvents.filter((e) => {
        const key = getActivityKey(e);
        return !key || !injectedActivityKeys.has(key);
    });
    const storedAndInjected = [...liveEventsWithoutSuperseded, ...injectedEvents];
    // When the REST commit list is available it replaces PushEvents entirely:
    // a stored PushEvent carries no commit details and counts as one commit
    // for the pusher, even when several authors contributed to the push.
    const storedEvents = commitsAreAuthoritative
        ? storedAndInjected.filter((e) => e.type !== EVENT_TYPES.PUSH_EVENT)
        : storedAndInjected;
    const events = dedupeById([...storedEvents, ...(commitEvents || [])]);

    if (events.length === 0 && (reconcileError || reconcileTruncated)) {
        const reason = reconcileError
            ? `reconciliation failed: ${reconcileError}`
            : 'reconciliation stopped before it covered the window';
        throw new Error(
            `No events available for window ${timePeriod.since}..${timePeriod.until} `
            + `and ${reason}`,
        );
    }

    const repoStat = await prepareRepoStat(events, commonRequestData, timePeriod);
    const contributors = prepareContributors(events);
    const activityStat = prepareActivityStat(contributors);
    const detailedActivityStat = prepareDetailedActivityStat(contributors);

    return { repoStat, activityStat, ...detailedActivityStat };
};
