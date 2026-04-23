import {
    mkdtemp, readFile, writeFile,
} from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { format } from 'date-fns';
import { appendMetadataRecord } from '../../src/tools/fs-utils';

const recA = {
    timestamp: '2026-04-21T01:00:00Z',
    totalEvents: 100,
    pagesCollected: 5,
    eventsWritten: 100,
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
}));

// eslint-disable-next-line import/first
import { pollEvents } from '../../src/poll-events';

describe('pollEvents — metadata is append-only', () => {
    it('writes one new record per call to the per-day file', async () => {
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
    });
});
