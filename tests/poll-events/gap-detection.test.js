import { mkdtemp, writeFile, readFile } from 'fs/promises';
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
import { getGithubEvents } from '../../src/tools/gh-utils';

const makeEvent = (isoTime) => ({
    id: `evt-${isoTime}`,
    type: 'IssuesEvent',
    created_at: isoTime,
    actor: { login: 'alice' },
    payload: { action: 'opened', issue: { labels: [] } },
});

const makeGhResponse = (eventTime) => ({
    events: [makeEvent(eventTime)],
    metadata: {
        totalEvents: 1,
        pagesCollected: 1,
        rateLimitReached: false,
        rateLimitRemaining: 4999,
        rateLimitReset: null,
        timestamp: new Date().toISOString(),
    },
});

describe('pollEvents — gap detection', () => {
    let dir;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'gap-'));
    });

    it('sets gapSuspected=true when last successful poll was >90 min ago', async () => {
        const today = format(new Date(), 'yyyy-MM-dd');
        const twoHoursAgo = subMinutes(new Date(), 120).toISOString();
        const oldRecord = {
            timestamp: twoHoursAgo,
            totalEvents: 5,
            pagesCollected: 1,
            eventsWritten: 5,
            rateLimitRemaining: 4995,
            rateLimitReached: false,
            rateLimitReset: null,
            oldestEventAt: subMinutes(new Date(), 130).toISOString(),
            newestEventAt: subMinutes(new Date(), 121).toISOString(),
            gapSuspected: false,
            error: null,
            collectionPath: dir,
            repo: 'a/b',
        };
        await writeFile(
            path.join(dir, `${today}-metadata.json`),
            JSON.stringify([oldRecord]),
        );
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(new Date().toISOString()));

        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const records = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(records).toHaveLength(2);
        expect(records[1].gapSuspected).toBe(true);
        expect(records[1].oldestEventAt).toBeDefined();
        expect(records[1].newestEventAt).toBeDefined();
    });

    it('sets gapSuspected=false when last successful poll was <90 min ago', async () => {
        const today = format(new Date(), 'yyyy-MM-dd');
        const thirtyMinAgo = subMinutes(new Date(), 30).toISOString();
        const recentRecord = {
            timestamp: thirtyMinAgo,
            totalEvents: 5,
            pagesCollected: 1,
            eventsWritten: 5,
            rateLimitRemaining: 4995,
            rateLimitReached: false,
            rateLimitReset: null,
            oldestEventAt: subMinutes(new Date(), 40).toISOString(),
            newestEventAt: subMinutes(new Date(), 31).toISOString(),
            gapSuspected: false,
            error: null,
            collectionPath: dir,
            repo: 'a/b',
        };
        await writeFile(
            path.join(dir, `${today}-metadata.json`),
            JSON.stringify([recentRecord]),
        );
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(new Date().toISOString()));

        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const records = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(records[1].gapSuspected).toBe(false);
    });
});
