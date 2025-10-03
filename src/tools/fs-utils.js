import {
    createWriteStream,
    createReadStream,
    pathExists,
    remove,
    readdir,
    ensureDir,
    writeFile,
} from 'fs-extra';
import {
    format,
    endOfYesterday,
    eachDayOfInterval,
} from 'date-fns';
import { intersection } from 'lodash/array';
import { Readable } from 'stream';
import { chain } from 'stream-chain';
import { parser } from 'stream-json/jsonl/Parser';
import { reduceStream } from './stream-utils';
import {
    isCreatedSince,
    isCreatedUntil,
    sortEventsByDate,
} from './events-utils';
import { MILLISECONDS_IN_DAY, COLLECTION_FILE_EXTENSION } from '../constants';

/**
 * Gets array of GitHub event objects from file and by timePeriod
 * @param {string} path path to the file to read from
 * @param {object} timePeriod
 * @return {Promise<Array<Object>>} array with GitHub event objects
 */
const getEventsFromFile = async (path, timePeriod) => {
    const { until, since } = timePeriod;
    const fileEventsStream = createReadStream(path, {
        flags: 'r',
    });
    const collectionStream = fileEventsStream.pipe(parser());

    const callback = (data, accArray) => {
        // Remove parser() wrapping
        const event = data.value;
        const createdUntil = isCreatedUntil(event, until);
        const createdSince = isCreatedSince(event, since);
        if (createdSince && createdUntil) {
            accArray.push(event);
        }
        // IMPORTANT: Always continue processing the stream,
        // so do not return `null`.
        // Otherwise, the stream will exit on the first event if it does not match timePeriod,
        // but following events may still match it.
        return undefined;
    };

    const eventsBySearchDate = await reduceStream(collectionStream, callback);

    return eventsBySearchDate;
};

/**
 * Gets array of GitHub event objects from collection and by search time
 * @param {string} path path to collection dir
 * @param {object} timePeriod
 * @return {Promise<Array<Object>>} array with GitHub event objects
 */
const getEventsFromCollection = async (path, timePeriod) => {
    const hasDir = await pathExists(path);
    if (!hasDir) {
        return [];
    }

    const wantedDates = eachDayOfInterval({
        start: new Date(timePeriod.since),
        end: new Date(timePeriod.until),
    });
    const wantedFilenames = wantedDates.map((date) => `${format(date, 'yyy-MM-dd')}${COLLECTION_FILE_EXTENSION}`);
    const ownedFilenames = await readdir(path);
    const filenamesInStock = intersection(wantedFilenames, ownedFilenames);
    const eventsFromPeriod = await Promise.all(filenamesInStock.map(async (filename) => {
        return getEventsFromFile(`${path}/${filename}`, timePeriod);
    }));

    return eventsFromPeriod.flat();
};

/**
 * Writes events from array to path as a stream, path is created if there is none
 * @param {string} path path to a file
 * @param {Array.<Object>} events array with GitHub event objects
 * @param {string} flag node flag for write stream
 */
const writeEventsToFile = async (path, events, flag) => {
    if (events.length === 0) {
        return;
    }

    const readable = new Readable({
        objectMode: true,
        read: () => { },
    });

    chain([
        readable,
        (event) => `${JSON.stringify(event)}\n`,
        createWriteStream(path, {
            flags: flag,
        }),
    ]);

    events.forEach((event) => {
        readable.push(event);
    });
};

/**
 * Sort events by date of creation and write them to a corresponding file
 * @param {string} path path to collection dir
 * @param {Array<Object>} events array with GitHub event objects
 */
const writePollToCollection = async (path, events) => {
    await ensureDir(path);
    const sortedPoll = sortEventsByDate(events);

    await Promise.all(Object.keys(sortedPoll).map((date) => {
        return writeEventsToFile(`${path}/${date}${COLLECTION_FILE_EXTENSION}`, sortedPoll[date], 'a');
    }));
};

/**
 * Remove duplicate events from a file
 * @param {string} path path to a file
 * @returns {Promise<number>} number of unique events after deduplication
 */
const removeDupesFromFile = async (path) => {
    const hasFile = await pathExists(path);
    if (!hasFile) {
        return 0;
    }

    const fileEventsStream = createReadStream(path, {
        flags: 'r',
    });
    const fileStream = fileEventsStream.pipe(parser());

    const callback = (data, accArray) => accArray.push(data.value);
    const fileArray = await reduceStream(fileStream, callback);

    const dedupedArray = [];
    fileArray.forEach((event) => {
        const dupeIndex = dedupedArray.findIndex((e) => {
            return e.id === event.id;
        });
        if (dupeIndex === -1) {
            dedupedArray.push(event);
        }
    });

    await writeEventsToFile(path, dedupedArray, 'w');
    return dedupedArray.length;
};

/**
 * Remove duplicate events from collection
 * @param {string} path path to a collection
 * @returns {Promise<number>} number of unique events in today's file after deduplication
 */
const removeDupesFromCollection = async (path) => {
    const hasCollection = await pathExists(path);
    if (!hasCollection) {
        return 0;
    }

    const currentDate = format(new Date(), 'yyy-MM-dd');
    const previousDate = format(endOfYesterday(), 'yyy-MM-dd');

    const currentCount = await removeDupesFromFile(`${path}/${currentDate}${COLLECTION_FILE_EXTENSION}`);
    await removeDupesFromFile(`${path}/${previousDate}${COLLECTION_FILE_EXTENSION}`);

    return currentCount;
};

/**
 * Deletes files that are older than specified
 * @param {string} path path to a collection
 * @param {number} expirationDays number of days representing events lifespan
 */
const removeOldFilesFromCollection = async (path, expirationDays) => {
    const filenames = await readdir(path);
    const expirationTime = expirationDays * MILLISECONDS_IN_DAY;

    const oldFilenames = filenames.filter((filename) => {
        const date = filename.substring(0, filename.indexOf(COLLECTION_FILE_EXTENSION));
        const daysOld = new Date(date).getTime();
        return Date.now() - daysOld > expirationTime;
    });

    oldFilenames.forEach(async (filename) => {
        // eslint-disable-next-line no-await-in-loop
        await remove(`${path}/${filename}`);
    });
};

/**
 * Writes metadata to a JSON file.
 *
 * @param {string} path Path to the file.
 * @param {Object} metadata Metadata to write.
 */
const writeMetadataToFile = async (path, metadata) => {
    await ensureDir(path.substring(0, path.lastIndexOf('/')));
    const metadataJson = JSON.stringify(metadata, null, 2);
    await writeFile(path, metadataJson);
};

export {
    getEventsFromCollection,
    writePollToCollection,
    removeDupesFromCollection,
    removeOldFilesFromCollection,
    writeMetadataToFile,
};
