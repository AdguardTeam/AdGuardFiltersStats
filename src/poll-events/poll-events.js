import path from 'path';
import { format } from 'date-fns';
import { getGithubEvents } from '../tools/gh-utils';
import { EVENT_EXPIRATION_DAYS } from '../constants';
import {
    removeOldFilesFromCollection,
    writePollToCollection,
    removeDupesFromCollection,
    appendMetadataRecord,
} from '../tools/fs-utils';

/**
 * Polls events from Github Events API and stores them on a given path
 *
 * @param {string} collectionPath path to events collection
 * @param {Object} commonRequestData
 * @returns {Promise<Object>} Collection metadata
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

        // Store metadata for diagnostics (one record per poll, append-only)
        const today = format(new Date(), 'yyyy-MM-dd');
        const metadataPath = path.join(collectionPath, `${today}-metadata.json`);
        await appendMetadataRecord(metadataPath, {
            timestamp: metadata.timestamp,
            totalEvents: metadata.totalEvents,
            pagesCollected: metadata.pagesCollected,
            eventsWritten: actualEventsWritten,
            rateLimitRemaining: metadata.rateLimitRemaining,
            rateLimitReached: metadata.rateLimitReached,
            rateLimitReset: metadata.rateLimitReset,
            gapSuspected: false,
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
