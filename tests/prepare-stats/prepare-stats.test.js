import { mkdtemp, copyFile } from 'fs/promises';
import { readFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

jest.mock('../../src/tools/gh-utils', () => {
    // Cannot reference out-of-scope vars in jest.mock factory; require inside.
    // eslint-disable-next-line global-require
    const fs = require('fs');
    // eslint-disable-next-line global-require
    const p = require('path');
    const fixtureDir = p.join(__dirname, '..', 'test-files', 'reconcile');
    const closedIssues = JSON.parse(
        fs.readFileSync(p.join(fixtureDir, 'closed-issues.json'), 'utf8'),
    );
    const pulls = JSON.parse(
        fs.readFileSync(p.join(fixtureDir, 'pulls.json'), 'utf8'),
    );
    return {
        getOpenIssues: jest.fn(async () => []),
        getClosedIssuesInWindow: jest.fn(async () => closedIssues),
        getPullsInWindow: jest.fn(async () => pulls),
    };
});

// eslint-disable-next-line import/first
import { prepareStats } from '../../src/prepare-stats';
// eslint-disable-next-line import/first
import { EXCLUDED_USERNAMES } from '../../src/constants';

const reconcileFixtureDir = path.join(__dirname, '..', 'test-files', 'reconcile');

const botClosedIssues = JSON.parse(
    readFileSync(path.join(reconcileFixtureDir, 'bot-closed-issues.json'), 'utf8'),
);

describe('prepareStats — reconciles missing closures from REST', () => {
    beforeEach(() => {
        process.env.RECONCILE = 'true';
    });
    afterEach(() => {
        delete process.env.RECONCILE;
    });

    it('counts a user1 resolved issue that was missing from the JSONL', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'stats-'));
        await copyFile(
            path.join(__dirname, '..', 'test-files', 'reconcile', 'collection.jsonl'),
            path.join(dir, '2026-04-21.jsonl'),
        );

        const stats = await prepareStats(
            dir,
            { owner: 'AdguardTeam', repo: 'AdguardFilters' },
            { since: '2026-04-21T00:00:00Z', until: '2026-04-21T23:59:59Z' },
        );

        // A human close of a stale-labelled issue counts as a regular resolution
        expect(stats.activitiesByUser.user1.resolvedIssues).toBe(2);
        // mergedPulls must equal merged PR count, not new PR count
        expect(stats.activitiesByUser.user1.mergedPulls).toBe(1);
        expect(stats.activitiesByUser.user1.newPulls).toBe(1);
        // Repo-level resolved counts all closes that are not performed by the stale bot
        expect(stats.repoStat.resolvedIssues).toBe(2);
        // Human closes are never counted as "closed as stale"
        expect(stats.repoStat.closedAsStaleIssues).toBe(0);
    });

    it.each(EXCLUDED_USERNAMES)(
        'counts a %s close of a stale issue as closedAsStaleIssues, not as a contributor resolution',
        async (botLogin) => {
            const dir = await mkdtemp(path.join(tmpdir(), 'stats-bot-stale-'));
            // eslint-disable-next-line global-require
            const gh = require('../../src/tools/gh-utils');
            gh.getClosedIssuesInWindow.mockResolvedValueOnce([
                { ...botClosedIssues[0], closed_by: { id: 41898282, login: botLogin } },
            ]);
            gh.getPullsInWindow.mockResolvedValueOnce([]);

            const stats = await prepareStats(
                dir,
                { owner: 'AdguardTeam', repo: 'AdguardFilters' },
                { since: '2026-04-21T00:00:00Z', until: '2026-04-21T23:59:59Z' },
            );

            expect(stats.repoStat.resolvedIssues).toBe(0);
            expect(stats.repoStat.closedAsStaleIssues).toBe(1);
            // The bot close must not be credited to any contributor
            expect(stats.activitiesByUser).toEqual({});
        },
    );

    it('counts a stale bot close of a non-stale issue as a regular resolution', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'stats-bot-resolved-'));
        // eslint-disable-next-line global-require
        const gh = require('../../src/tools/gh-utils');
        gh.getClosedIssuesInWindow.mockResolvedValueOnce([
            { ...botClosedIssues[0], labels: [] },
        ]);
        gh.getPullsInWindow.mockResolvedValueOnce([]);

        const stats = await prepareStats(
            dir,
            { owner: 'AdguardTeam', repo: 'AdguardFilters' },
            { since: '2026-04-21T00:00:00Z', until: '2026-04-21T23:59:59Z' },
        );

        expect(stats.repoStat.resolvedIssues).toBe(1);
        expect(stats.repoStat.closedAsStaleIssues).toBe(0);
        // The bot close must not be credited to any contributor
        expect(stats.activitiesByUser).toEqual({});
    });
});

describe('prepareStats — hard fail on unrecoverable empty window', () => {
    beforeEach(() => {
        process.env.RECONCILE = 'true';
        // Force REST to fail
        // eslint-disable-next-line global-require
        const gh = require('../../src/tools/gh-utils');
        gh.getClosedIssuesInWindow.mockRejectedValueOnce(new Error('rate limit'));
        gh.getPullsInWindow.mockRejectedValueOnce(new Error('rate limit'));
    });

    afterEach(() => {
        delete process.env.RECONCILE;
    });

    it('throws when both the collection is empty and REST is unavailable', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'stats-empty-'));
        await expect(prepareStats(
            dir,
            { owner: 'AdguardTeam', repo: 'AdguardFilters' },
            { since: '2026-04-21T00:00:00Z', until: '2026-04-21T23:59:59Z' },
        )).rejects.toThrow(/reconciliation failed/i);
    });
});
