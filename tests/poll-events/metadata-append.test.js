import {
    mkdtemp, readFile, writeFile, chmod,
} from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { format } from 'date-fns';
import { appendMetadataRecord } from '../../src/tools/fs-utils';

const recA = {
    timestamp: '2026-04-21T01:00:00Z',
    totalEvents: 100,
    pagesCollected: 5,
    eventsInFile: 100,
    rateLimitRemaining: 4900,
    rateLimitReached: false,
    rateLimitReset: '2026-04-21T02:00:00Z',
    gapSuspected: false,
    error: null,
};
const recB = { ...recA, timestamp: '2026-04-21T02:00:00Z', totalEvents: 110 };

describe('appendMetadataRecord', () => {
    let dir;
    let file;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'meta-'));
        file = path.join(dir, '2026-04-21-metadata.json');
    });

    it('creates a file with a one-element array on first call', async () => {
        await appendMetadataRecord(file, recA);
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        expect(Array.isArray(parsed)).toBe(true);
        expect(parsed).toEqual([recA]);
    });

    it('appends to an existing array', async () => {
        await appendMetadataRecord(file, recA);
        await appendMetadataRecord(file, recB);
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        expect(parsed).toEqual([recA, recB]);
    });

    it('migrates a legacy single-object file to an array', async () => {
        await writeFile(file, JSON.stringify({ legacy: true }), 'utf8');
        await appendMetadataRecord(file, recA);
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        expect(parsed).toEqual([{ legacy: true }, recA]);
    });

    it('treats a corrupted file as empty and writes a one-element array', async () => {
        await writeFile(file, 'not valid json{{{', 'utf8');
        await appendMetadataRecord(file, recA);
        const parsed = JSON.parse(await readFile(file, 'utf8'));
        expect(parsed).toEqual([recA]);
    });
});

jest.mock('../../src/tools/gh-utils', () => ({
    getGithubEvents: jest.fn(async () => ({
        events: [{
            id: '1',
            type: 'IssuesEvent',
            created_at: '2026-04-21T10:00:00Z',
            actor: { login: 'alice' },
            payload: { action: 'opened', issue: { labels: [] } },
        }],
        metadata: {
            totalEvents: 1,
            pagesCollected: 1,
            rateLimitReached: false,
            rateLimitRemaining: 4999,
            rateLimitReset: '2026-04-21T11:00:00Z',
            timestamp: '2026-04-21T10:00:01Z',
        },
    })),
    getOpenIssues: jest.fn(async () => []),
    getClosedIssuesInWindow: jest.fn(async () => []),
    getPullsInWindow: jest.fn(async () => []),
}));

// eslint-disable-next-line import/first
import { pollEvents } from '../../src/poll-events';
// eslint-disable-next-line import/first
import { getGithubEvents } from '../../src/tools/gh-utils';

// A non-writable directory blocks the write only for a non-root user.
const canBlockWrites = typeof process.getuid === 'function' && process.getuid() !== 0;
const itUnlessRoot = canBlockWrites ? it : it.skip;

describe('pollEvents — metadata is append-only', () => {
    it('writes one new record per call to the per-day file', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date('2026-04-21T12:00:00Z'));

        try {
            const dir = await mkdtemp(path.join(tmpdir(), 'poll-'));
            await pollEvents(dir, { owner: 'a', repo: 'b' });
            await pollEvents(dir, { owner: 'a', repo: 'b' });
            const today = format(new Date(), 'yyyy-MM-dd');
            const parsed = JSON.parse(
                await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
            );
            expect(Array.isArray(parsed)).toBe(true);
            expect(parsed.length).toBe(2);
            expect(parsed[0].totalEvents).toBe(1);
        } finally {
            jest.useRealTimers();
        }
    });

    itUnlessRoot('returns a failure instead of crashing when the collection is not writable', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'poll-ro-'));
        await chmod(dir, 0o555);

        try {
            const result = await pollEvents(dir, { owner: 'a', repo: 'b' });

            // The entry reports this line; the library only returns the reason.
            expect(result.success).toBe(false);
            expect(result.error).toContain('EACCES');
        } finally {
            await chmod(dir, 0o755);
        }
    });

    it('records a rate-limited failure in the metadata', async () => {
        const error = Object.assign(
            new Error('GitHub API rate limit exceeded. Retry in 60 seconds'),
            {
                rateLimitReached: true,
                rateLimitReset: null,
            },
        );
        getGithubEvents.mockRejectedValueOnce(error);

        const dir = await mkdtemp(path.join(tmpdir(), 'poll-rate-limit-'));
        const result = await pollEvents(dir, { owner: 'a', repo: 'b' });

        expect(result.success).toBe(false);
        expect(result.metadata.rateLimitReached).toBe(true);

        const today = format(new Date(), 'yyyy-MM-dd');
        const parsed = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(parsed).toHaveLength(1);
        expect(parsed[0].rateLimitReached).toBe(true);
        expect(parsed[0].rateLimitReset).toBeNull();
        expect(parsed[0].backfillTruncated).toBe(false);
        expect(parsed[0].backfillBudgetExceeded).toBe(false);
        expect(parsed[0].backfillError).toBeNull();
        expect(parsed[0].error).toBe(error.message);
    });

    it('stores a failed poll error on one line', async () => {
        getGithubEvents.mockRejectedValueOnce(new Error('Request failed\nwith a body:\n<html>'));

        const dir = await mkdtemp(path.join(tmpdir(), 'poll-multiline-'));
        const result = await pollEvents(dir, { owner: 'a', repo: 'b' });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Request failed with a body: <html>');

        const today = format(new Date(), 'yyyy-MM-dd');
        const parsed = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(parsed[0].error).toBe('Request failed with a body: <html>');
    });

    it('stores a non-empty reason when the failure text is empty', async () => {
        // A record without a reason counts as a successful poll, so an empty
        // text would hide the failure and skip the retry of the window.
        getGithubEvents.mockRejectedValueOnce(Object.assign(new Error(' \r\n'), { status: 502 }));

        const dir = await mkdtemp(path.join(tmpdir(), 'poll-empty-error-'));
        const result = await pollEvents(dir, { owner: 'a', repo: 'b' });

        expect(result.success).toBe(false);
        expect(result.error).toBe('poll failed (502)');

        const today = format(new Date(), 'yyyy-MM-dd');
        const parsed = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(parsed[0].error).toBe('poll failed (502)');
    });
});
