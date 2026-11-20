import {
    mkdtemp, readFile, readdir, writeFile,
} from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { format, subMinutes } from 'date-fns';

jest.mock('../../src/tools/gh-utils', () => ({
    getGithubEvents: jest.fn(),
    getOpenIssues: jest.fn(async () => []),
    getClosedIssuesInWindow: jest.fn(async () => []),
    getPullsInWindow: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { pollEvents } from '../../src/poll-events';
// eslint-disable-next-line import/first
import { getClosedIssuesInWindow, getGithubEvents } from '../../src/tools/gh-utils';
// eslint-disable-next-line import/first
import { logger } from '../../src/tools/logger';

const makeEvent = (id, createdAt) => ({
    id,
    type: 'IssuesEvent',
    created_at: createdAt,
    actor: { login: 'alice' },
    payload: { action: 'opened', issue: { labels: [] } },
});

const makeGhResponse = (events, timestamp) => ({
    events,
    metadata: {
        totalEvents: events.length,
        pagesCollected: 1,
        rateLimitReached: false,
        rateLimitRemaining: 4999,
        rateLimitReset: null,
        timestamp,
    },
});

const readTodayRecords = async (dir) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    return JSON.parse(await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'));
};

const readStoredEvents = async (dir) => {
    const files = (await readdir(dir)).filter((name) => name.endsWith('.jsonl'));
    const contents = await Promise.all(
        files.map((name) => readFile(path.join(dir, name), 'utf8')),
    );
    return contents
        .flatMap((raw) => raw.trim().split('\n').filter(Boolean))
        .map((line) => JSON.parse(line));
};

const makeMetadataRecord = (overrides = {}) => ({
    timestamp: subMinutes(new Date(), 30).toISOString(),
    totalEvents: 5,
    pagesCollected: 1,
    eventsInFile: 5,
    skippedEvents: 0,
    rateLimitRemaining: 4995,
    rateLimitReached: false,
    rateLimitReset: null,
    oldestEventAt: null,
    newestEventAt: null,
    gapSuspected: false,
    backfillTruncated: false,
    backfillBudgetExceeded: false,
    backfillError: null,
    error: null,
    collectionPath: '',
    repo: 'a/b',
    ...overrides,
});

const writeTodayRecords = async (dir, records) => {
    const today = format(new Date(), 'yyyy-MM-dd');
    await writeFile(path.join(dir, `${today}-metadata.json`), JSON.stringify(records));
};

describe('pollEvents — batch bounds and an empty batch', () => {
    let dir;
    let warn;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'poll-batch-'));
        warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warn.mockRestore();
    });

    it('skips an event with an unreadable created_at instead of failing the poll', async () => {
        const eventTime = subMinutes(new Date(), 5).toISOString();
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(
            [makeEvent('1', eventTime), makeEvent('2', 'not-a-date')],
            new Date().toISOString(),
        ));

        const result = await pollEvents(dir, { owner: 'a', repo: 'b' });

        expect(result.success).toBe(true);
        const records = await readTodayRecords(dir);
        expect(records).toHaveLength(1);
        expect(records[0].error).toBeNull();
        expect(records[0].skippedEvents).toBe(1);
        // The readable events still date the batch.
        expect(records[0].oldestEventAt).toBe(eventTime);
        expect(records[0].newestEventAt).toBe(eventTime);
        expect(warn.mock.calls.flat().join(' ')).toContain('Skipped 1 event');
        // The unreadable event has no day to be stored on.
        const stored = await readStoredEvents(dir);
        expect(stored.map((event) => event.id)).toEqual(['1']);
    });

    it('falls back to the poll timestamp when no event has a readable created_at', async () => {
        const timestamp = new Date().toISOString();
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(
            [makeEvent('1', 'not-a-date')],
            timestamp,
        ));

        const result = await pollEvents(dir, { owner: 'a', repo: 'b' });

        expect(result.success).toBe(true);
        const records = await readTodayRecords(dir);
        expect(records[0].error).toBeNull();
        expect(records[0].skippedEvents).toBe(1);
        expect(records[0].oldestEventAt).toBe(timestamp);
        expect(records[0].newestEventAt).toBe(timestamp);
        expect(warn.mock.calls.flat().join(' ')).toContain('Skipped 1 event');
    });

    it('records an empty batch as a successful zero-event poll', async () => {
        const timestamp = new Date().toISOString();
        getGithubEvents.mockResolvedValueOnce(makeGhResponse([], timestamp));

        const result = await pollEvents(dir, { owner: 'a', repo: 'b' });

        expect(result.success).toBe(true);
        expect(result.metadata.totalEvents).toBe(0);
        expect(result.metadata.eventsInFile).toBe(0);
        const records = await readTodayRecords(dir);
        expect(records).toHaveLength(1);
        expect(records[0].totalEvents).toBe(0);
        expect(records[0].skippedEvents).toBe(0);
        expect(records[0].error).toBeNull();
        expect(records[0].oldestEventAt).toBe(timestamp);
        expect(records[0].newestEventAt).toBe(timestamp);
    });

    it('runs the stale-file cleanup for an empty batch', async () => {
        const staleFile = path.join(dir, '2020-01-01.jsonl');
        await writeFile(staleFile, '', 'utf8');
        getGithubEvents.mockResolvedValueOnce(makeGhResponse([], new Date().toISOString()));

        await pollEvents(dir, { owner: 'a', repo: 'b' });

        await expect(readFile(staleFile, 'utf8')).rejects.toThrow(/ENOENT/);
    });

    it('creates the collection directory for an empty batch', async () => {
        const collectionPath = path.join(dir, 'nested', 'collection');
        getGithubEvents.mockResolvedValueOnce(makeGhResponse([], new Date().toISOString()));

        const result = await pollEvents(collectionPath, { owner: 'a', repo: 'b' });

        expect(result.success).toBe(true);
        expect(await readTodayRecords(collectionPath)).toHaveLength(1);
    });

    it('treats a null or numeric created_at as unreadable', async () => {
        // `new Date(null)` is the epoch, not a failure, so a presence check
        // would store such an event on 1970-01-01 and poison the next gap.
        const eventTime = subMinutes(new Date(), 5).toISOString();
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(
            [makeEvent('1', eventTime), makeEvent('2', null), makeEvent('3', 0)],
            new Date().toISOString(),
        ));

        const result = await pollEvents(dir, { owner: 'a', repo: 'b' });

        expect(result.success).toBe(true);
        const records = await readTodayRecords(dir);
        expect(records[0].skippedEvents).toBe(2);
        expect(records[0].oldestEventAt).toBe(eventTime);
        expect(records[0].newestEventAt).toBe(eventTime);
        expect(warn.mock.calls.flat().join(' ')).toContain('Skipped 2 events');
        const stored = await readStoredEvents(dir);
        expect(stored.map((event) => event.id)).toEqual(['1']);
    });

    it('backfills the gap of an empty batch from the last successful poll', async () => {
        const now = new Date();
        const previous = makeMetadataRecord({
            timestamp: subMinutes(now, 120).toISOString(),
            oldestEventAt: subMinutes(now, 130).toISOString(),
            newestEventAt: subMinutes(now, 121).toISOString(),
        });
        await writeTodayRecords(dir, [previous]);
        const timestamp = now.toISOString();
        getGithubEvents.mockResolvedValueOnce(makeGhResponse([], timestamp));

        const result = await pollEvents(dir, { owner: 'a', repo: 'b' });

        expect(result.success).toBe(true);
        const records = await readTodayRecords(dir);
        // The poll time is the end of the window that the empty batch leaves
        // open, so the backfill covers the time since the last poll.
        expect(records[1].gapSuspected).toBe(true);
        expect(records[1].oldestEventAt).toBe(timestamp);
        expect(records[1].newestEventAt).toBe(timestamp);
        expect(getClosedIssuesInWindow).toHaveBeenLastCalledWith(
            { owner: 'a', repo: 'b' },
            { since: previous.newestEventAt, until: timestamp },
            expect.any(Object),
        );
    });
});
