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
import {
    getClosedIssuesInWindow,
    getGithubEvents,
    getPullsInWindow,
} from '../../src/tools/gh-utils';

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
            eventsInFile: 5,
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
        expect(records[1].backfillTruncated).toBe(false);
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
            eventsInFile: 5,
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

    it('sets gapSuspected=true on event-based gap (oldest > newest + 90min)', async () => {
        const today = format(new Date(), 'yyyy-MM-dd');
        // Last poll was 10 minutes ago (within time threshold),
        // but the events indicate a gap: previous newest event was 3 hours ago
        const tenMinAgo = subMinutes(new Date(), 10).toISOString();
        const threeHoursAgo = subMinutes(new Date(), 180).toISOString();
        const recentRecord = {
            timestamp: tenMinAgo,
            totalEvents: 5,
            pagesCollected: 1,
            eventsInFile: 5,
            rateLimitRemaining: 4995,
            rateLimitReached: false,
            rateLimitReset: null,
            oldestEventAt: subMinutes(new Date(), 190).toISOString(),
            newestEventAt: threeHoursAgo,
            gapSuspected: false,
            error: null,
            collectionPath: dir,
            repo: 'a/b',
        };
        await writeFile(
            path.join(dir, `${today}-metadata.json`),
            JSON.stringify([recentRecord]),
        );
        // Current poll returns an event created just now — gap between
        // threeHoursAgo and now exceeds 90 minutes
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(new Date().toISOString()));

        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const records = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(records).toHaveLength(2);
        expect(records[1].gapSuspected).toBe(true);
    });

    it('records backfillTruncated=true when the backfill stops at the time budget', async () => {
        const today = format(new Date(), 'yyyy-MM-dd');
        const twoHoursAgo = subMinutes(new Date(), 120).toISOString();
        const oldRecord = {
            timestamp: twoHoursAgo,
            totalEvents: 5,
            pagesCollected: 1,
            eventsInFile: 5,
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
        getClosedIssuesInWindow.mockImplementationOnce(async (requestData, period, { budget }) => {
            // eslint-disable-next-line no-param-reassign -- the real walk marks the shared budget
            budget.truncated = true;
            return [];
        });

        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const records = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(records[1].gapSuspected).toBe(true);
        expect(records[1].backfillTruncated).toBe(true);
    });

    it('counts a truncated backfill as the last successful poll', async () => {
        const today = format(new Date(), 'yyyy-MM-dd');
        const completeRecord = {
            timestamp: subMinutes(new Date(), 180).toISOString(),
            totalEvents: 5,
            pagesCollected: 1,
            eventsInFile: 5,
            rateLimitRemaining: 4995,
            rateLimitReached: false,
            rateLimitReset: null,
            oldestEventAt: subMinutes(new Date(), 190).toISOString(),
            newestEventAt: subMinutes(new Date(), 181).toISOString(),
            gapSuspected: false,
            backfillTruncated: false,
            error: null,
            collectionPath: dir,
            repo: 'a/b',
        };
        const truncatedRecord = {
            ...completeRecord,
            timestamp: subMinutes(new Date(), 10).toISOString(),
            newestEventAt: subMinutes(new Date(), 5).toISOString(),
            gapSuspected: true,
            backfillTruncated: true,
        };
        await writeFile(
            path.join(dir, `${today}-metadata.json`),
            JSON.stringify([completeRecord, truncatedRecord]),
        );
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(new Date().toISOString()));

        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const records = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        // A truncated backfill is recorded, and its batch is the newest data:
        // the next poll starts from it instead of retrying the same window.
        expect(records[2].gapSuspected).toBe(false);
    });

    it('skips a backfill when the event batches overlap', async () => {
        const today = format(new Date(), 'yyyy-MM-dd');
        const oldRecord = {
            timestamp: subMinutes(new Date(), 120).toISOString(),
            totalEvents: 5,
            pagesCollected: 1,
            eventsInFile: 5,
            rateLimitRemaining: 4995,
            rateLimitReached: false,
            rateLimitReset: null,
            oldestEventAt: subMinutes(new Date(), 130).toISOString(),
            newestEventAt: subMinutes(new Date(), 100).toISOString(),
            gapSuspected: false,
            error: null,
            collectionPath: dir,
            repo: 'a/b',
        };
        await writeFile(
            path.join(dir, `${today}-metadata.json`),
            JSON.stringify([oldRecord]),
        );
        // The batch reaches back past the previous newest event: there is no
        // missing interval, so the inverted window must not be reconciled.
        const overlapping = makeGhResponse(new Date().toISOString());
        overlapping.events = [
            makeEvent(new Date().toISOString()),
            makeEvent(subMinutes(new Date(), 110).toISOString()),
        ];
        getGithubEvents.mockResolvedValueOnce(overlapping);
        const callsBefore = getClosedIssuesInWindow.mock.calls.length;

        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const records = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(records[1].gapSuspected).toBe(true);
        expect(records[1].backfillError).toBeNull();
        expect(records[1].backfillTruncated).toBe(false);
        expect(getClosedIssuesInWindow.mock.calls.length).toBe(callsBefore);

        // The record is a successful poll, so the next one sees no gap.
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(new Date().toISOString()));
        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const secondRecords = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(secondRecords[2].gapSuspected).toBe(false);
    });

    it('retries the gap when the previous backfill failed', async () => {
        const today = format(new Date(), 'yyyy-MM-dd');
        const oldRecord = {
            timestamp: subMinutes(new Date(), 120).toISOString(),
            totalEvents: 5,
            pagesCollected: 1,
            eventsInFile: 5,
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
        getClosedIssuesInWindow.mockRejectedValueOnce(new Error('rate limit'));
        getPullsInWindow.mockResolvedValueOnce([]);

        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const firstRecords = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(firstRecords[1].backfillError).toContain('rate limit');

        // The failed backfill must not hide the gap on the next poll, and the
        // retried window must start at the last successful poll.
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(new Date().toISOString()));
        const callsBefore = getClosedIssuesInWindow.mock.calls.length;
        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const secondRecords = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(secondRecords[2].gapSuspected).toBe(true);
        expect(getClosedIssuesInWindow.mock.calls.length).toBe(callsBefore + 1);
        expect(getClosedIssuesInWindow.mock.calls.at(-1)[1]).toEqual({
            since: oldRecord.newestEventAt,
            until: expect.any(String),
        });
    });
});
