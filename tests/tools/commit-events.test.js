import { buildCommitEvents } from '../../src/tools/commit-events';
import { getCommitsCount } from '../../src/tools/events-utils';
import { EVENT_TYPES } from '../../src/constants';

const repo = { id: 0, name: 'AdguardTeam/AdguardFilters' };

const makeCommit = ({
    sha,
    login,
    committerDate,
    authorDate = committerDate,
    parents = [],
}) => ({
    sha,
    author: login ? { id: 42, login } : null,
    commit: {
        message: `message ${sha}`,
        author: { name: login || 'unlinked', date: authorDate },
        committer: { date: committerDate },
    },
    parents: parents.map((parentSha) => ({ sha: parentSha })),
});

describe('buildCommitEvents', () => {
    it('builds one PushEvent per commit attributed to the commit author', () => {
        const events = buildCommitEvents([
            makeCommit({ sha: 'aaa', login: 'Yuki2718', committerDate: '2026-11-01T15:31:10Z' }),
            makeCommit({ sha: 'bbb', login: 'mu-hun', committerDate: '2026-11-01T17:47:07Z' }),
        ], repo);

        expect(events.map((e) => e.actor.login)).toEqual(['Yuki2718', 'mu-hun']);
        expect(events.every((e) => e.type === EVENT_TYPES.PUSH_EVENT)).toBe(true);
        expect(events.map((e) => e.id)).toEqual([
            'synthetic-commit-aaa',
            'synthetic-commit-bbb',
        ]);
    });

    it('uses the committer date as the event time', () => {
        const [event] = buildCommitEvents([
            makeCommit({
                sha: 'aaa',
                login: 'Yuki2718',
                committerDate: '2026-11-01T17:46:23Z',
                authorDate: '2026-10-30T10:00:00Z',
            }),
        ], repo);

        expect(event.created_at).toBe('2026-11-01T17:46:23Z');
    });

    it('puts exactly one commit into the payload so existing counters add up', () => {
        const events = buildCommitEvents([
            makeCommit({ sha: 'aaa', login: 'Yuki2718', committerDate: '2026-11-01T15:31:10Z' }),
            makeCommit({ sha: 'bbb', login: 'mu-hun', committerDate: '2026-11-01T17:47:07Z' }),
        ], repo);

        expect(getCommitsCount(events)).toBe(2);
        expect(events[0].payload.commits).toHaveLength(1);
        expect(events[0].payload.commits[0].sha).toBe('aaa');
        expect(events[0].payload.head).toBe('aaa');
    });

    it('links the commit to its parent commit', () => {
        const [event] = buildCommitEvents([
            makeCommit({
                sha: 'aaa',
                login: 'Yuki2718',
                committerDate: '2026-11-01T15:31:10Z',
                parents: ['parent-sha'],
            }),
        ], repo);

        expect(event.payload.before).toBe('parent-sha');
    });

    it('skips commits without a linked GitHub author or committer date', () => {
        const events = buildCommitEvents([
            makeCommit({ sha: 'no-author', login: null, committerDate: '2026-11-01T15:31:10Z' }),
            makeCommit({ sha: 'no-date', login: 'Yuki2718', committerDate: null }),
            makeCommit({ sha: 'valid', login: 'mu-hun', committerDate: '2026-11-01T17:47:07Z' }),
        ], repo);

        expect(events.map((e) => e.payload.head)).toEqual(['valid']);
    });
});
