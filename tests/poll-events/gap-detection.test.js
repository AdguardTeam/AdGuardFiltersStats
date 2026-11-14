import {
    mkdtemp, writeFile, readFile, readdir,
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
import {
    getClosedIssuesInWindow,
    getGithubEvents,
    getPullsInWindow,
} from '../../src/tools/gh-utils';
// eslint-disable-next-line import/first
import { logger } from '../../src/tools/logger';

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

const readStoredEvents = async (dir) => {
    const files = (await readdir(dir)).filter((name) => name.endsWith('.jsonl'));
    const contents = await Promise.all(
        files.map((name) => readFile(path.join(dir, name), 'utf8')),
    );
    return contents
        .flatMap((raw) => raw.trim().split('\n').filter(Boolean))
        .map((line) => JSON.parse(line));
};

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

    it('does not backfill an equal-bounds window', async () => {
        const today = format(new Date(), 'yyyy-MM-dd');
        const eventTime = new Date().toISOString();
        const oldRecord = {
            timestamp: subMinutes(new Date(), 120).toISOString(),
            totalEvents: 5,
            pagesCollected: 1,
            eventsInFile: 5,
            rateLimitRemaining: 4995,
            rateLimitReached: false,
            rateLimitReset: null,
            oldestEventAt: subMinutes(new Date(), 130).toISOString(),
            // The current batch starts exactly at the previous newest event:
            // the boundary event is already stored, so there is no missing
            // interval and an empty window must not be reconciled.
            newestEventAt: eventTime,
            gapSuspected: false,
            error: null,
            collectionPath: dir,
            repo: 'a/b',
        };
        await writeFile(
            path.join(dir, `${today}-metadata.json`),
            JSON.stringify([oldRecord]),
        );
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(eventTime));
        const callsBefore = getClosedIssuesInWindow.mock.calls.length;

        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const records = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(records[1].gapSuspected).toBe(true);
        expect(records[1].backfillTruncated).toBe(false);
        expect(records[1].backfillBudgetExceeded).toBe(false);
        expect(getClosedIssuesInWindow.mock.calls.length).toBe(callsBefore);
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
        let capturedBudget;
        getClosedIssuesInWindow.mockImplementationOnce(async (requestData, period, { budget }) => {
            capturedBudget = budget;
            // eslint-disable-next-line no-param-reassign -- the real walk marks the shared budget
            budget.truncated = true;
            // eslint-disable-next-line no-param-reassign -- the real walk marks the shared budget
            budget.budgetExceeded = true;
            return [];
        });
        const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

        try {
            await pollEvents(dir, { owner: 'a', repo: 'b' });

            const records = JSON.parse(
                await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
            );
            expect(records[1].gapSuspected).toBe(true);
            expect(records[1].backfillTruncated).toBe(true);
            expect(records[1].backfillBudgetExceeded).toBe(true);
            expect(capturedBudget.progress).toBe(true);
            expect(warn).toHaveBeenCalledWith(expect.stringMatching(/^::warning::.*time budget/));
        } finally {
            warn.mockRestore();
        }
    });

    it('records a page-limit truncation and warns with an annotation', async () => {
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
        getClosedIssuesInWindow.mockImplementationOnce(async (requestData, period, { budget }) => {
            // eslint-disable-next-line no-param-reassign -- the real walk marks the shared budget at the page limit
            budget.truncated = true;
            return [];
        });
        const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

        try {
            await pollEvents(dir, { owner: 'a', repo: 'b' });

            const records = JSON.parse(
                await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
            );
            expect(records[1].gapSuspected).toBe(true);
            expect(records[1].backfillTruncated).toBe(true);
            expect(records[1].backfillBudgetExceeded).toBe(false);
            expect(warn).toHaveBeenCalledWith(
                expect.stringMatching(/^::warning::.*pagination limit/),
            );
        } finally {
            warn.mockRestore();
        }
    });

    it('counts a page-limit-truncated backfill as the last successful poll', async () => {
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
            backfillBudgetExceeded: false,
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
            backfillBudgetExceeded: false,
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
        // A page-limit truncation is recorded, and its batch is the newest
        // data: the next poll starts from it instead of retrying the same
        // window, because every walk restarts from the newest page.
        expect(records[2].gapSuspected).toBe(false);
    });

    it('retries a budget-stopped backfill from the last successful poll', async () => {
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
            backfillBudgetExceeded: false,
            error: null,
            collectionPath: dir,
            repo: 'a/b',
        };
        const budgetStoppedRecord = {
            ...completeRecord,
            timestamp: subMinutes(new Date(), 10).toISOString(),
            newestEventAt: subMinutes(new Date(), 5).toISOString(),
            gapSuspected: true,
            backfillTruncated: true,
            backfillBudgetExceeded: true,
        };
        await writeFile(
            path.join(dir, `${today}-metadata.json`),
            JSON.stringify([completeRecord, budgetStoppedRecord]),
        );
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(new Date().toISOString()));

        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const records = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        // The budget stop does not move the window forward: the next poll
        // retries from the last successful poll's newest event.
        expect(records[2].gapSuspected).toBe(true);
        expect(getClosedIssuesInWindow).toHaveBeenLastCalledWith(
            { owner: 'a', repo: 'b' },
            { since: completeRecord.newestEventAt, until: expect.any(String) },
            expect.any(Object),
        );
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

    it('stores the issues walk events when the pulls walk fails and retries the window', async () => {
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
        const closedAt = subMinutes(new Date(), 60).toISOString();
        const closedIssue = {
            id: 4001,
            number: 42,
            closed_at: closedAt,
            closed_by: { id: 7, login: 'zloyden' },
            labels: [],
        };
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(new Date().toISOString()));
        getClosedIssuesInWindow.mockResolvedValueOnce([closedIssue]);
        getPullsInWindow.mockRejectedValueOnce(new Error('pulls rate limit'));

        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const firstRecords = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(firstRecords[1].backfillError).toContain('pulls rate limit');
        const syntheticIssueId = `synthetic-issue-closed-4001-${new Date(closedAt).getTime()}`;
        const firstStored = await readStoredEvents(dir);
        expect(firstStored.filter((e) => e.id === syntheticIssueId)).toHaveLength(1);

        // The failed pulls walk must not move the window forward, so the next
        // poll retries the window from the last successful poll.
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(new Date().toISOString()));
        getClosedIssuesInWindow.mockResolvedValueOnce([closedIssue]);
        const callsBefore = getPullsInWindow.mock.calls.length;
        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const secondRecords = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(secondRecords[2].gapSuspected).toBe(true);
        expect(getPullsInWindow.mock.calls.length).toBe(callsBefore + 1);
        expect(getPullsInWindow.mock.calls.at(-1)[1]).toEqual({
            since: oldRecord.newestEventAt,
            until: expect.any(String),
        });
        // The retried walk returns the same closure, which stays stored once.
        const secondStored = await readStoredEvents(dir);
        expect(secondStored.filter((e) => e.id === syntheticIssueId)).toHaveLength(1);
    });

    it('stores the pulls walk events when the issues walk fails and retries the window', async () => {
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
        const pull = {
            id: 5001,
            number: 300,
            created_at: subMinutes(new Date(), 70).toISOString(),
            merged_at: subMinutes(new Date(), 60).toISOString(),
            user: { id: 9, login: 'user1' },
        };
        getGithubEvents.mockResolvedValueOnce(makeGhResponse(new Date().toISOString()));
        getClosedIssuesInWindow.mockRejectedValueOnce(new Error('issues rate limit'));
        getPullsInWindow.mockResolvedValueOnce([pull]);

        await pollEvents(dir, { owner: 'a', repo: 'b' });

        const firstRecords = JSON.parse(
            await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
        );
        expect(firstRecords[1].backfillError).toContain('issues rate limit');
        const firstStored = await readStoredEvents(dir);
        const storedIds = firstStored.map((e) => e.id);
        expect(storedIds).toEqual(expect.arrayContaining([
            'synthetic-pr-opened-5001',
            'synthetic-pr-merged-5001',
        ]));

        // The failed issues walk must not move the window forward, so the next
        // poll retries the window from the last successful poll.
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

    it('records a merge failure and retries the window', async () => {
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
        getClosedIssuesInWindow.mockResolvedValueOnce([{
            id: 4001,
            number: 42,
            closed_at: subMinutes(new Date(), 60).toISOString(),
            closed_by: { id: 7, login: 'zloyden' },
            labels: [],
        }]);
        // eslint-disable-next-line global-require
        const fsUtils = require('../../src/tools/fs-utils');
        const merge = jest.spyOn(fsUtils, 'mergeSyntheticEventsIntoCollection')
            .mockRejectedValueOnce(new Error('disk full'));
        const warn = jest.spyOn(logger, 'warn').mockImplementation(() => {});

        try {
            const result = await pollEvents(dir, { owner: 'a', repo: 'b' });

            const records = JSON.parse(
                await readFile(path.join(dir, `${today}-metadata.json`), 'utf8'),
            );
            // The poll still succeeds, records the failure as the retry
            // reason, and keeps the reconciliation error in the diagnostics.
            expect(result.success).toBe(true);
            expect(records[1].backfillError).toContain('disk full');
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('disk full'));
            expect(warn.mock.calls.flat().join(' ')).toContain('The next poll retries');
        } finally {
            merge.mockRestore();
            warn.mockRestore();
        }
    });
});
