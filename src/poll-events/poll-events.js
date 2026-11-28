import path from 'path';
import { format, subDays } from 'date-fns';
import { getGithubEvents } from '../tools/gh-utils';
import { reconcileWindow } from '../tools/reconcile';
import { EVENT_EXPIRATION_DAYS, METADATA_FILE_SUFFIX, POLL_GAP_THRESHOLD_MS } from '../constants';
import { logger } from '../tools/logger';
import { describeError, normalizeErrorMessage } from '../tools/error-utils';
import {
    removeOldFilesFromCollection,
    writePollToCollection,
    removeDupesFromCollection,
    appendMetadataRecord,
    readMetadataRecords,
    mergeSyntheticEventsIntoCollection,
} from '../tools/fs-utils';

/**
 * Builds the path to the metadata sidecar of a given day.
 *
 * @param {string} collectionPath Path to events collection.
 * @param {Date} date Day of the sidecar.
 *
 * @returns {string} Path to the metadata sidecar.
 */
const getMetadataPath = (collectionPath, date) => {
    const day = format(date, 'yyyy-MM-dd');
    return path.join(collectionPath, `${day}${METADATA_FILE_SUFFIX}`);
};

/**
 * Report whether a value is a non-empty string that converts to a usable
 * timestamp.
 *
 * A metadata record is read back from the collection, so a hand-edited or
 * truncated record can hold a value that `new Date()` cannot parse. Such a
 * value turns every comparison into `NaN`, and a `NaN` comparison is false,
 * so the gap would be skipped without a message. An event takes its
 * `created_at` from the API, and that value can be absent or numeric. Only
 * a non-empty string is a timestamp: `new Date(null)` is the epoch, not a
 * failure, and such an event would reach the collection as 1970-01-01.
 *
 * @param {unknown} value Value to check.
 *
 * @returns {boolean} `true` when the value is a non-empty string with a finite epoch time.
 */
const isValidTimestamp = (value) => typeof value === 'string'
    && value.length > 0
    && Number.isFinite(new Date(value).getTime());

/**
 * Polls events from Github Events API and stores them on a given path.
 *
 * @param {string} collectionPath Path to events collection.
 * @param {object} commonRequestData GitHub API request parameters.
 *
 * @returns {Promise<{success: boolean, error?: string, metadata: object}>} `success` and the
 * poll metadata; a failed poll also holds `error`.
 */
export const pollEvents = async (collectionPath, commonRequestData) => {
    try {
        // Get events from GitHub API with enhanced error handling
        const { events: fetchedEvents, metadata } = await getGithubEvents(commonRequestData);

        // An event without a readable `created_at` has no day to be stored on,
        // and one such value turns both batch bounds into `NaN`. Drop it before
        // the batch is stored, and report how many events are affected. An
        // empty batch is a normal poll: it still records its metadata and still
        // runs the cleanup, so a quiet repository exits 0.
        const events = fetchedEvents.filter((event) => isValidTimestamp(event.created_at));
        const skippedEventsCount = fetchedEvents.length - events.length;
        if (skippedEventsCount > 0) {
            const noun = skippedEventsCount === 1 ? 'event' : 'events';
            logger.warn(
                `⚠️ Skipped ${skippedEventsCount} ${noun} with an unreadable created_at. `
                + 'Such an event cannot be placed on a day.',
            );
        }

        // Write events to collection. The call creates the collection
        // directory, so the cleanup below also runs for an empty batch.
        await writePollToCollection(collectionPath, events);
        const actualEventsWritten = await removeDupesFromCollection(collectionPath);
        await removeOldFilesFromCollection(collectionPath, EVENT_EXPIRATION_DAYS);

        // Compute event time bounds for gap detection and diagnostics. A batch
        // without a readable event time, such as an empty batch, falls back to
        // the poll time, so the record stays usable for the next poll.
        const eventTimes = events.map((event) => new Date(event.created_at).getTime());
        const pollTime = metadata.timestamp;
        const oldestEventAt = eventTimes.length > 0
            ? new Date(Math.min(...eventTimes)).toISOString()
            : pollTime;
        const newestEventAt = eventTimes.length > 0
            ? new Date(Math.max(...eventTimes)).toISOString()
            : pollTime;

        // Read the current and the previous day metadata to detect a gap. A
        // poll after midnight must still find the last successful poll of the
        // previous day, and a failed or budget-stopped backfill recorded before
        // midnight must still be retried. Two sidecars are enough: the read
        // stays bounded and never scans the whole collection. A sidecar that
        // cannot be read is not authoritative, so it must not fail a poll that
        // already stored its events.
        const now = new Date();
        const metadataPath = getMetadataPath(collectionPath, now);
        const previousMetadataPath = getMetadataPath(collectionPath, subDays(now, 1));
        const previousRecords = await readMetadataRecords(previousMetadataPath).catch((error) => {
            logger.warn(`⚠️ Cannot read ${previousMetadataPath}: ${normalizeErrorMessage(error)}`);
            return [];
        });
        const todayRecords = await readMetadataRecords(metadataPath);
        // The previous day's records come first: the sidecar day is taken from
        // a clock read after the Events fetch, so it is never earlier than the
        // record's own timestamp, and each sidecar is append-only. The
        // concatenated order is therefore chronological.
        // A failed backfill and a backfill that ran out of budget must not
        // move the window forward: the next poll retries the gap from the
        // last successful poll. A page-limit truncation still counts as
        // successful because every walk starts from the newest page, so a
        // retry cannot reach the un-walked tail.
        const lastSuccessful = [...previousRecords, ...todayRecords]
            .filter((record) => !record.error && !record.backfillError && !record.backfillBudgetExceeded)
            .at(-1);
        if (!lastSuccessful) {
            logger.warn(
                '⚠️ No successful poll in the current and previous day metadata. '
                + 'Gap detection is skipped.',
            );
        }

        let gapSuspected = false;
        let gapWindowSince = null;
        let backfillTruncated = false;
        let backfillBudgetExceeded = false;
        let backfillError = null;
        if (lastSuccessful) {
            // A record can hold a value that `new Date()` cannot parse, and a
            // comparison with such a value is `NaN`, which is false. The gap
            // would then be skipped without a message. Each field can date the
            // gap, so an unreadable one falls back to the other, and the
            // replacement is reported.
            const hasEventTimestamp = isValidTimestamp(lastSuccessful.newestEventAt);
            const hasPollTimestamp = isValidTimestamp(lastSuccessful.timestamp);
            if (!hasEventTimestamp && !hasPollTimestamp) {
                logger.warn(
                    '⚠️ Last successful poll has an invalid newestEventAt and timestamp. '
                    + 'The gap check is skipped.',
                );
            } else if (!hasEventTimestamp) {
                const invalidValue = normalizeErrorMessage(lastSuccessful.newestEventAt);
                logger.warn(
                    `⚠️ Last successful poll has an invalid newestEventAt (${invalidValue || 'missing'}). `
                    + 'The gap is measured from its timestamp.',
                );
            } else if (!hasPollTimestamp) {
                const invalidValue = normalizeErrorMessage(lastSuccessful.timestamp);
                logger.warn(
                    `⚠️ Last successful poll has an invalid timestamp (${invalidValue || 'missing'}). `
                    + 'The gap is measured from its newestEventAt.',
                );
            }
            if (hasEventTimestamp || hasPollTimestamp) {
                const baselineEventAt = hasEventTimestamp
                    ? lastSuccessful.newestEventAt
                    : lastSuccessful.timestamp;
                const baselinePollAt = hasPollTimestamp
                    ? lastSuccessful.timestamp
                    : lastSuccessful.newestEventAt;
                const msSinceLast = Date.now() - new Date(baselinePollAt).getTime();
                const oldestEventTime = new Date(oldestEventAt).getTime();
                const baselineTime = new Date(baselineEventAt).getTime();
                const eventBasedGap = (oldestEventTime - baselineTime) > POLL_GAP_THRESHOLD_MS;
                if (msSinceLast > POLL_GAP_THRESHOLD_MS || eventBasedGap) {
                    gapSuspected = true;
                    gapWindowSince = baselineEventAt;
                }
            }
        }

        // Backfill the missing event window. After a slow poll the current
        // batch can reach back past the previous newest event, so an empty or
        // inverted window needs no backfill.
        const windowMissing = gapWindowSince
            && new Date(oldestEventAt) > new Date(gapWindowSince);
        if (windowMissing) {
            const gapWindow = { since: gapWindowSince, until: oldestEventAt };
            const repoMeta = { id: 0, name: `${commonRequestData.owner}/${commonRequestData.repo}` };
            const {
                injectedEvents,
                error: reconciliationError,
                truncated,
                budgetExceeded,
            } = await reconcileWindow(
                commonRequestData,
                gapWindow,
                repoMeta,
                { progress: true },
            );
            backfillTruncated = truncated;
            backfillBudgetExceeded = budgetExceeded;
            backfillError = reconciliationError;
            // A failed walk loses only its own data: store what the other walk
            // recovered. The error still keeps the window from advancing, so
            // the next poll retries the failed endpoint. A write failure must
            // not fail the poll or hide the reconciliation error, so record it
            // as another reason to retry the window.
            if (injectedEvents.length > 0) {
                try {
                    await mergeSyntheticEventsIntoCollection(collectionPath, injectedEvents);
                } catch (mergeError) {
                    // A retry reason must never be empty, so both the write
                    // failure and the composed reason go through
                    // `describeError`; the composed call also bounds the whole
                    // reason after its prefix.
                    const mergeMessage = describeError(
                        `failed to store the recovered events: ${describeError(mergeError, 'store failed')}`,
                    );
                    // Each reason is one bounded line. Truncating the joined
                    // text would cut the write failure that just happened, so
                    // the parts are kept as they are.
                    backfillError = backfillError
                        ? `${backfillError}; ${mergeMessage}`
                        : mergeMessage;
                    logger.warn(`⚠️ ${mergeMessage}. The next poll retries the window.`);
                }
            }
            if (backfillError) {
                logger.warn(`⚠️ Gap detected but backfill failed: ${backfillError}`);
            }
            if (backfillBudgetExceeded) {
                logger.warn(
                    '::warning::Gap backfill stopped at the time budget. The next poll retries the window.',
                );
            } else if (backfillTruncated) {
                logger.warn(
                    '::warning::Gap backfill stopped at the pagination limit. Some events may be missing.',
                );
            }
        }

        // Store metadata for diagnostics (one record per poll, append-only)
        await appendMetadataRecord(metadataPath, {
            timestamp: pollTime,
            totalEvents: metadata.totalEvents,
            pagesCollected: metadata.pagesCollected,
            eventsInFile: actualEventsWritten,
            skippedEvents: skippedEventsCount,
            rateLimitRemaining: metadata.rateLimitRemaining,
            rateLimitReached: metadata.rateLimitReached,
            rateLimitReset: metadata.rateLimitReset,
            oldestEventAt,
            newestEventAt,
            gapSuspected,
            backfillTruncated,
            backfillBudgetExceeded,
            backfillError,
            error: null,
            collectionPath,
            repo: `${commonRequestData.owner}/${commonRequestData.repo}`,
        });

        // Return success status and metadata
        return {
            success: true,
            metadata: {
                ...metadata,
                eventsInFile: actualEventsWritten,
            },
        };
    } catch (error) {
        // A stored reason must never be empty: the next poll reads a record
        // without a reason as a success, so the failed window would never be
        // retried.
        const message = describeError(error, 'poll failed');
        const rateLimitReached = error?.rateLimitReached === true;
        const rateLimitReset = error?.rateLimitReset ?? null;
        try {
            await appendMetadataRecord(
                getMetadataPath(collectionPath, new Date()),
                {
                    timestamp: new Date().toISOString(),
                    totalEvents: 0,
                    pagesCollected: 0,
                    eventsInFile: 0,
                    rateLimitRemaining: null,
                    rateLimitReached,
                    rateLimitReset,
                    oldestEventAt: null,
                    newestEventAt: null,
                    gapSuspected: false,
                    backfillTruncated: false,
                    backfillBudgetExceeded: false,
                    backfillError: null,
                    error: message,
                    collectionPath,
                    repo: `${commonRequestData.owner}/${commonRequestData.repo}`,
                },
            );
        } catch (metaErr) {
            // Writing error metadata failed — log and continue so the original error is still reported.
            logger.error('Failed to persist error metadata:', normalizeErrorMessage(metaErr));
        }
        // Return failure status and error information
        return {
            success: false,
            error: message,
            metadata: {
                timestamp: new Date().toISOString(),
                error: message,
                rateLimitReached,
                rateLimitReset,
            },
        };
    }
};
