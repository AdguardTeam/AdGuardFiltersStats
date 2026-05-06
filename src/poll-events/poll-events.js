import path from 'path';
import { format } from 'date-fns';
import { getGithubEvents } from '../tools/gh-utils';
import { reconcileWindow } from '../tools/reconcile';
import { EVENT_EXPIRATION_DAYS, POLL_GAP_THRESHOLD_MS } from '../constants';
import {
    removeOldFilesFromCollection,
    writePollToCollection,
    removeDupesFromCollection,
    appendMetadataRecord,
    readMetadataRecords,
    mergeSyntheticEventsIntoCollection,
} from '../tools/fs-utils';

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
            // eslint-disable-next-line no-console
            console.error('No events were collected from GitHub API');
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

        // Read previous metadata to detect gap
        const today = format(new Date(), 'yyyy-MM-dd');
        const metadataPath = path.join(collectionPath, `${today}-metadata.json`);
        const prevRecords = await readMetadataRecords(metadataPath);
        const lastSuccessful = prevRecords.filter((r) => !r.error).at(-1);

        let gapSuspected = false;
        let gapWindowSince = null;
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

        // Backfill gap window from REST when a gap is detected
        if (gapSuspected && gapWindowSince) {
            const gapWindow = { since: gapWindowSince, until: oldestEventAt };
            const repoMeta = { id: 0, name: `${commonRequestData.owner}/${commonRequestData.repo}` };
            // eslint-disable-next-line function-paren-newline
            const { injectedEvents, error: backfillError } = await reconcileWindow(
                commonRequestData, gapWindow, repoMeta);
            if (backfillError) {
                // eslint-disable-next-line no-console
                console.warn(`⚠️ Gap detected but backfill failed: ${backfillError}`);
            } else if (injectedEvents.length > 0) {
                await mergeSyntheticEventsIntoCollection(collectionPath, injectedEvents);
            }
        }

        // Store metadata for diagnostics (one record per poll, append-only)
        await appendMetadataRecord(metadataPath, {
            timestamp: metadata.timestamp,
            totalEvents: metadata.totalEvents,
            pagesCollected: metadata.pagesCollected,
            eventsWritten: actualEventsWritten,
            rateLimitRemaining: metadata.rateLimitRemaining,
            rateLimitReached: metadata.rateLimitReached,
            rateLimitReset: metadata.rateLimitReset,
            oldestEventAt,
            newestEventAt,
            gapSuspected,
            error: null,
            collectionPath,
            repo: `${commonRequestData.owner}/${commonRequestData.repo}`,
        });

        // Return success status and metadata
        return {
            success: true,
            metadata: {
                ...metadata,
                eventsWritten: actualEventsWritten,
            },
        };
    } catch (error) {
        const today = format(new Date(), 'yyyy-MM-dd');
        try {
            await appendMetadataRecord(
                path.join(collectionPath, `${today}-metadata.json`),
                {
                    timestamp: new Date().toISOString(),
                    totalEvents: 0,
                    pagesCollected: 0,
                    eventsWritten: 0,
                    rateLimitRemaining: null,
                    rateLimitReached: false,
                    rateLimitReset: null,
                    oldestEventAt: null,
                    newestEventAt: null,
                    gapSuspected: false,
                    error: error.message,
                    collectionPath,
                    repo: `${commonRequestData.owner}/${commonRequestData.repo}`,
                },
            );
        } catch (_) { /* swallow secondary IO error */ }
        // eslint-disable-next-line no-console
        console.error('Error in pollEvents:', error.message);
        // Return failure status and error information
        return {
            success: false,
            error: error.message,
            metadata: {
                timestamp: new Date().toISOString(),
                error: error.message,
            },
        };
    }
};
