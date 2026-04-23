import { readFile, mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
    buildSyntheticEvents,
} from '../../src/tools/reconcile';
import {
    mergeSyntheticEventsIntoCollection,
} from '../../src/tools/fs-utils';

const repo = { id: 1, name: 'AdguardTeam/AdguardFilters' };

const loadFixture = async (name) => JSON.parse(
    await readFile(path.join(__dirname, '..', 'test-files', 'reconcile', name), 'utf8'),
);

describe('buildSyntheticEvents', () => {
    it('builds a closed IssuesEvent for each non-null closed_by', async () => {
        const issues = await loadFixture('closed-issues.json');
        const events = buildSyntheticEvents({ closedIssues: issues, pulls: [], repo });
        const issueEvents = events.filter((e) => e.type === 'IssuesEvent');
        expect(issueEvents.map((e) => e.actor.login)).toEqual(['user1', 'user1']);
        // Stale label is preserved on the issue payload so isStale works
        const staleEvent = issueEvents.find((e) => e.payload.issue.number === 229200);
        expect(staleEvent.payload.issue.labels.map((l) => l.name)).toContain('Stale');
        // Null-actor row is dropped
        expect(issueEvents.find((e) => e.payload.issue.number === 229300)).toBeUndefined();
    });

    it('builds opened and merged PullRequestEvents using pull_request.user', async () => {
        const pulls = await loadFixture('pulls.json');
        const events = buildSyntheticEvents({ closedIssues: [], pulls, repo });
        const prEvents = events.filter((e) => e.type === 'PullRequestEvent');
        // PR 300: opened + merged → 2 events; PR 301: opened only → 1 event
        expect(prEvents).toHaveLength(3);
        const merged = prEvents.find((e) => e.payload.action === 'closed');
        expect(merged.payload.pull_request.merged_at).toBe('2026-04-21T09:00:00Z');
        expect(merged.actor.login).toBe('user1');
    });

    it('produces stable, idempotent ids', async () => {
        const issues = await loadFixture('closed-issues.json');
        const pulls = await loadFixture('pulls.json');
        const a = buildSyntheticEvents({ closedIssues: issues, pulls, repo });
        const b = buildSyntheticEvents({ closedIssues: issues, pulls, repo });
        expect(a.map((e) => e.id)).toEqual(b.map((e) => e.id));
        // Synthetic ids are namespaced
        expect(a.every((e) => e.id.startsWith('synthetic-'))).toBe(true);
    });
});

describe('mergeSyntheticEventsIntoCollection', () => {
    it('writes new synthetic events to the right dated jsonl file and dedupes', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'merge-'));
        // Pre-existing live event in 2026-04-21.jsonl that must not be duplicated
        const liveEvent = {
            id: 'live-1',
            type: 'IssuesEvent',
            created_at: '2026-04-21T05:00:00Z',
            actor: { login: 'alice' },
            payload: { action: 'closed', issue: { labels: [] } },
        };
        await writeFile(
            path.join(dir, '2026-04-21.jsonl'),
            `${JSON.stringify(liveEvent)}\n`,
        );

        const synthetic = [
            // New event — should be added
            {
                id: 'synthetic-issue-closed-4001-1745217074000',
                type: 'IssuesEvent',
                created_at: '2026-04-21T06:31:14Z',
                actor: { login: 'zloyden' },
                payload: { action: 'closed', issue: { labels: [] } },
            },
            // Same id repeated — must collapse
            {
                id: 'synthetic-issue-closed-4001-1745217074000',
                type: 'IssuesEvent',
                created_at: '2026-04-21T06:31:14Z',
                actor: { login: 'zloyden' },
                payload: { action: 'closed', issue: { labels: [] } },
            },
        ];

        await mergeSyntheticEventsIntoCollection(dir, synthetic);

        const lines = (await readFile(path.join(dir, '2026-04-21.jsonl'), 'utf8'))
            .trim().split('\n').map(JSON.parse);
        expect(lines.map((e) => e.id).sort()).toEqual([
            'live-1',
            'synthetic-issue-closed-4001-1745217074000',
        ]);
    });
});
