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
    getActivityKey,
    isCreatedSince,
    isCreatedUntil,
    sortEventsByDate,
} from './events-utils';
import {
    MILLISECONDS_IN_DAY,
    COLLECTION_FILE_EXTENSION,
} from '../constants';
import { logger } from './logger';

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
 * Gets array of GitHub event objects from file and by timePeriod.
 *
 * @param {string} path Path to the file to read from.
 * @param {object} timePeriod Time window with since and until.
 *
 * @returns {Promise<Array<object>>} Array with GitHub event objects.
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
 * Pattern of a file that belongs to the collection.
 *
 * A day file is `YYYY-MM-DD.jsonl` and its sidecar is
 * `YYYY-MM-DD-metadata.json`. The pattern covers the whole name, so a
 * date-like file such as `YYYY-MM-DD-backup.jsonl` is not a collection
 * file and is left in place.
 */
const COLLECTION_FILE_NAME_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:\.jsonl|-metadata\.json)$/;

/**
 * Extract the day from a collection file name.
 *
 * @param {string} filename File name from the collection directory.
 *
 * @returns {string|null} The `YYYY-MM-DD` day, or `null` for another file.
 */
const getCollectionFileDay = (filename) => {
    const match = COLLECTION_FILE_NAME_PATTERN.exec(filename);

    return match ? match[1] : null;
};

/**
 * Gets array of GitHub event objects from collection and by search time.
 *
 * @param {string} path Path to collection dir.
 * @param {object} timePeriod Time window with since and until.
 *
 * @returns {Promise<Array<object>>} Array with GitHub event objects.
 */
const getEventsFromCollection = async (path, timePeriod) => {
    const hasDir = await pathExists(path);
    if (!hasDir) {
        return [];
    }

    const ownedFilenames = await readdir(path);
    let filenamesInStock;
    if (timePeriod.since) {
        const wantedDates = eachDayOfInterval({
            start: new Date(timePeriod.since),
            end: new Date(timePeriod.until),
        });
        const wantedFilenames = wantedDates
            .map((date) => `${format(date, 'yyy-MM-dd')}${COLLECTION_FILE_EXTENSION}`);
        filenamesInStock = intersection(wantedFilenames, ownedFilenames);
    } else {
        // Without a lower bound the report covers every stored event, as the
        // README promises. The collection holds at most the expiration window
        // of day files, so reading them all stays bounded.
        filenamesInStock = ownedFilenames.filter((filename) => {
            return filename.endsWith(COLLECTION_FILE_EXTENSION)
                && getCollectionFileDay(filename) !== null;
        });
    }

    const eventsFromPeriod = await Promise.all(filenamesInStock.map(async (filename) => {
        return getEventsFromFile(`${path}/${filename}`, timePeriod);
    }));

    return eventsFromPeriod.flat();
};

/**
 * Writes events from array to path as a stream, path is created if there is none.
 *
 * @param {string} path Path to a file.
 * @param {Array.<object>} events Array with GitHub event objects.
 * @param {string} flag Node flag for write stream.
 */
const writeEventsToFile = async (path, events, flag) => {
    if (events.length === 0) {
        return;
    }

    await new Promise((resolve, reject) => {
        const readable = new Readable({
            objectMode: true,
            read: () => { },
        });

        const writeStream = createWriteStream(path, { flags: flag });
        // `stream-chain` re-emits the error of every inner stream on the chain
        // itself. Without a listener on the chain, a filesystem write failure
        // (for example EACCES on a read-only collection) is an unhandled
        // `error` event that crashes the process instead of rejecting this
        // promise. The callers then cannot treat the write as best effort.
        const writeChain = chain([
            readable,
            (event) => `${JSON.stringify(event)}\n`,
            writeStream,
        ]);

        /**
         * Rejects the write and releases the streams of a failed chain.
         *
         * @param {Error} error Error emitted by the chain or by a stream.
         */
        const onError = (error) => {
            writeChain.destroy();
            writeStream.destroy();
            readable.destroy();
            reject(error);
        };

        writeStream.on('finish', resolve);
        writeChain.on('error', onError);
        readable.on('error', onError);

        events.forEach((event) => {
            readable.push(event);
        });
        readable.push(null);
    });
};

/**
 * Sort events by date of creation and write them to a corresponding file.
 *
 * @param {string} path Path to collection dir.
 * @param {Array<object>} events Array with GitHub event objects.
 */
const writePollToCollection = async (path, events) => {
    await mkdir(path, { recursive: true });
    const sortedPoll = sortEventsByDate(events);

    await Promise.all(Object.keys(sortedPoll).map((date) => {
        return writeEventsToFile(`${path}/${date}${COLLECTION_FILE_EXTENSION}`, sortedPoll[date], 'a');
    }));
};

/**
 * Remove duplicate events from a file.
 *
 * @param {string} path Path to a file.
 *
 * @returns {Promise<number>} Number of unique events after deduplication.
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
 * Remove duplicate events from collection.
 *
 * @param {string} path Path to a collection.
 *
 * @returns {Promise<number>} Number of unique events in today's file after deduplication.
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
 * Deletes files that are older than specified.
 *
 * A day file and its metadata sidecar expire together: the gap baseline
 * reads only the current and the previous day, so an older sidecar is no
 * longer needed.
 *
 * @param {string} path Path to a collection.
 * @param {number} expirationDays Number of days representing events lifespan.
 */
const removeOldFilesFromCollection = async (path, expirationDays) => {
    const filenames = await readdir(path);
    const expirationTime = expirationDays * MILLISECONDS_IN_DAY;

    const oldFilenames = filenames.filter((filename) => {
        const day = getCollectionFileDay(filename);
        if (!day) {
            return false;
        }
        const daysOld = new Date(day).getTime();
        return Date.now() - daysOld > expirationTime;
    });

    await Promise.all(oldFilenames.map((filename) => {
        return unlink(`${path}/${filename}`);
    }));
};

/**
 * Read all metadata records from a per-day JSON file.
 * Returns an empty array if the file does not exist.
 * Migrates legacy single-object files to an array on read.
 *
 * @param {string} filePath Per-day metadata file path.
 *
 * @returns {Promise<Array<object>>} Array of metadata records (see PollMetadataRecord).
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
        logger.warn(`⚠️ Metadata file is corrupted (${filePath}), treating as empty.`);
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
 * @param {string} filePath Per-day metadata file path.
 * @param {object} record Metadata record (see PollMetadataRecord).
 */
const appendMetadataRecord = async (filePath, record) => {
    await mkdir(dirname(filePath), { recursive: true });
    const existing = await readMetadataRecords(filePath);
    existing.push(record);
    await writeFile(filePath, JSON.stringify(existing, null, 2));
};

/**
 * Read the activity keys already stored in one date-aligned JSONL file.
 *
 * A retried backfill can cover events that the previous poll already stored
 * as live Events-API events. Their ids differ from the synthetic ids, so the
 * id-based dedupe cannot collapse them; the activity key can.
 *
 * @param {string} filePath Path to the collection file.
 *
 * @returns {Promise<Set<string>>} Activity keys already stored in the file.
 */
const readStoredActivityKeys = async (filePath) => {
    if (!(await pathExists(filePath))) {
        return new Set();
    }
    const stored = await getEventsFromFile(filePath, {
        since: '1970-01-01T00:00:00Z',
        until: '9999-12-31T23:59:59Z',
    });
    return new Set(stored.map(getActivityKey).filter(Boolean));
};

/**
 * Append synthetic events to their date-aligned JSONL files and run
 * dedupe so the existing id-based dedupe collapses repeats. A synthetic
 * event whose activity is already stored as a live event is skipped, so a
 * retried backfill does not double-count one closure or pull request.
 *
 * @param {string} collectionPath Path to the collection root.
 * @param {Array<object>} events Synthetic events with `id` and `created_at`.
 */
const mergeSyntheticEventsIntoCollection = async (collectionPath, events) => {
    if (!events || events.length === 0) {
        return;
    }
    await mkdir(collectionPath, { recursive: true });
    const sorted = sortEventsByDate(events);
    await Promise.all(Object.keys(sorted).map(async (date) => {
        const filePath = `${collectionPath}/${date}${COLLECTION_FILE_EXTENSION}`;
        const storedKeys = await readStoredActivityKeys(filePath);
        const fresh = sorted[date].filter((event) => {
            const key = getActivityKey(event);
            return !key || !storedKeys.has(key);
        });
        await writeEventsToFile(filePath, fresh, 'a');
        await removeDupesFromFile(filePath);
    }));
};

export {
    getEventsFromCollection,
    writePollToCollection,
    removeDupesFromCollection,
    removeOldFilesFromCollection,
    appendMetadataRecord,
    mergeSyntheticEventsIntoCollection,
    readMetadataRecords,
};
