import { getGithubEvents } from './tools/gh-utils';
import { EVENT_EXPIRATION_DAYS } from './constants';
import {
    removeOldFilesFromCollection,
    writePollToCollection,
    removeDupesFromCollection,
} from './tools/fs-utils';

/**
 * Polls events from Github Events API and stores them on a given path
 *
 * @param {string} collectionPath path to events collection
 * @param {Object} commonRequestData
 */
export const pollEvents = async (collectionPath, commonRequestData) => {
    const newPoll = await getGithubEvents(commonRequestData);
    await writePollToCollection(collectionPath, newPoll);
    await removeDupesFromCollection(collectionPath);
    await removeOldFilesFromCollection(collectionPath, EVENT_EXPIRATION_DAYS);
};
