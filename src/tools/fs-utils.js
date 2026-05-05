import { createWriteStream, createReadStream } from 'node:fs';
import {
    access,
    unlink,
    readdir,
    mkdir,
    writeFile,
    readFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
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
 * Check if path exists.
 *
 * @param {string} path Path to check.
 *
 * @returns {Promise<boolean>} True if path exists.
 */
const pathExists = async (path) => {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
};

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
    await mkdir(path, { recursive: true });
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

    await Promise.all(oldFilenames.map((filename) => {
        return unlink(`${path}/${filename}`);
    }));
};

/**
 * Writes metadata to a JSON file.
 *
 * @param {string} path Path to the file.
 * @param {Object} metadata Metadata to write.
 */
const writeMetadataToFile = async (path, metadata) => {
    await mkdir(path.substring(0, path.lastIndexOf('/')), { recursive: true });
    const metadataJson = JSON.stringify(metadata, null, 2);
    await writeFile(path, metadataJson);
};

/**
 * Read all metadata records from a per-day JSON file.
 * Returns an empty array if the file does not exist.
 * Migrates legacy single-object files to an array on read.
 *
 * @param {string} filePath Per-day metadata file path.
 * @returns {Promise<Array<Object>>} Array of metadata records (see PollMetadataRecord).
 */
const readMetadataRecords = async (filePath) => {
    if (!(await pathExists(filePath))) {
        return [];
    }

    const raw = await readFile(filePath, 'utf8');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        // eslint-disable-next-line no-console
        console.warn(`⚠️ Metadata file is corrupted (${filePath}), treating as empty.`);
        return [];
    }

    return Array.isArray(parsed) ? parsed : [parsed];
};

/**
 * Append a metadata record to a per-day JSON file.
 * Creates the file as a one-element array if it does not exist.
 * Migrates legacy single-object files to a two-element array on first
 * append. Treats a corrupted file as empty (warns to stderr).
 *
 * @param {string} filePath  per-day metadata file path
 * @param {Object} record    metadata record (see PollMetadataRecord)
 */
const appendMetadataRecord = async (filePath, record) => {
    await mkdir(dirname(filePath), { recursive: true });
    const existing = await readMetadataRecords(filePath);
    existing.push(record);
    await writeFile(filePath, JSON.stringify(existing, null, 2));
};

/**
 * Append synthetic events to their date-aligned JSONL files and run
 * dedupe so the existing id-based dedupe collapses repeats.
 *
 * @param {string} collectionPath  path to the collection root
 * @param {Array<Object>} events   synthetic events with `id` and `created_at`
 */
const mergeSyntheticEventsIntoCollection = async (collectionPath, events) => {
    if (!events || events.length === 0) return;
    await mkdir(collectionPath, { recursive: true });
    const sorted = sortEventsByDate(events);
    await Promise.all(Object.keys(sorted).map((date) => writeEventsToFile(
        `${collectionPath}/${date}${COLLECTION_FILE_EXTENSION}`,
        sorted[date],
        'a',
    )));
    await Promise.all(Object.keys(sorted).map((date) => removeDupesFromFile(
        `${collectionPath}/${date}${COLLECTION_FILE_EXTENSION}`,
    )));
};

export {
    getEventsFromCollection,
    writePollToCollection,
    removeDupesFromCollection,
    removeOldFilesFromCollection,
    writeMetadataToFile,
    appendMetadataRecord,
    mergeSyntheticEventsIntoCollection,
    readMetadataRecords,
};
