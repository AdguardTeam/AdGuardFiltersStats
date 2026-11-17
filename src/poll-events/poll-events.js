import path from 'path';
import { format, subDays } from 'date-fns';
import { getGithubEvents } from '../tools/gh-utils';
import { reconcileWindow } from '../tools/reconcile';
import { EVENT_EXPIRATION_DAYS, POLL_GAP_THRESHOLD_MS } from '../constants';
import { logger } from '../tools/logger';
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
    return path.join(collectionPath, `${day}-metadata.json`);
};

/**
 * Polls events from Github Events API and stores them on a given path.
 *
 * @param {string} collectionPath Path to events collection.
 * @param {object} commonRequestData GitHub API request parameters.
 *
 * @returns {Promise<object>} Collection metadata.
 */
export const pollEvents = async (collectionPath, commonRequestData) => {
    try {
        // Get events from GitHub API with enhanced error handling
        const { events, metadata } = await getGithubEvents(commonRequestData);

        if (events.length === 0) {
            logger.error('No events were collected from GitHub API');
            return { success: false, metadata };
        }

        // Write events to collection
        await writePollToCollection(collectionPath, events);
        const actualEventsWritten = await removeDupesFromCollection(collectionPath);
        await removeOldFilesFromCollection(collectionPath, EVENT_EXPIRATION_DAYS);

        // Compute event time bounds for gap detection and diagnostics
        const eventTimes = events.map((e) => new Date(e.created_at).getTime());
        const oldestEventAt = new Date(Math.min(...eventTimes)).toISOString();
        const newestEventAt = new Date(Math.max(...eventTimes)).toISOString();

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
            logger.warn(`⚠️ Cannot read ${previousMetadataPath}: ${error.message}`);
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
            const msSinceLast = Date.now() - new Date(lastSuccessful.timestamp).getTime();
            const oldestEventTime = new Date(oldestEventAt).getTime();
            const lastEventTime = new Date(lastSuccessful.newestEventAt).getTime();
            const eventBasedGap = lastSuccessful.newestEventAt
                && (oldestEventTime - lastEventTime) > POLL_GAP_THRESHOLD_MS;
            if (msSinceLast > POLL_GAP_THRESHOLD_MS || eventBasedGap) {
                gapSuspected = true;
                gapWindowSince = lastSuccessful.newestEventAt || lastSuccessful.timestamp;
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
                    const mergeMessage = `failed to store the recovered events: ${mergeError.message}`;
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
            timestamp: metadata.timestamp,
            totalEvents: metadata.totalEvents,
            pagesCollected: metadata.pagesCollected,
            eventsInFile: actualEventsWritten,
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
                    error: error.message,
                    collectionPath,
                    repo: `${commonRequestData.owner}/${commonRequestData.repo}`,
                },
            );
        } catch (metaErr) {
            // Writing error metadata failed — log and continue so the original error is still reported.
            logger.error('Failed to persist error metadata:', metaErr.message);
        }
        logger.error('Error in pollEvents:', error.message);
        // Return failure status and error information
        return {
            success: false,
            error: error.message,
            metadata: {
                timestamp: new Date().toISOString(),
                error: error.message,
                rateLimitReached,
                rateLimitReset,
            },
        };
    }
};
