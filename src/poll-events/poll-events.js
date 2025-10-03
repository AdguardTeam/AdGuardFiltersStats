import path from 'path';
import { format } from 'date-fns';
import { getGithubEvents } from '../tools/gh-utils';
import { EVENT_EXPIRATION_DAYS } from '../constants';
import {
    removeOldFilesFromCollection,
    writePollToCollection,
    removeDupesFromCollection,
    writeMetadataToFile,
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

        // Store metadata for diagnostics
        const today = format(new Date(), 'yyyy-MM-dd');
        const metadataPath = path.join(collectionPath, `${today}-metadata.json`);
        await writeMetadataToFile(metadataPath, {
            ...metadata,
            eventsWritten: actualEventsWritten,
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
