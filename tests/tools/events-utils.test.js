import {
    countEventsByType,
    getActivityAuthor,
    getActivityKey,
    getCommitsCount,
    isClosedAsStale,
    isDecisionReview,
    isMerged,
} from '../../src/tools/events-utils';
import {
    DECISION_REVIEW_STATES,
    EVENT_TYPES,
    LABEL_NAMES,
    EXCLUDED_USERNAMES,
} from '../../src/constants';

const makeCloseEvent = ({ actor, labels }) => ({
    type: EVENT_TYPES.ISSUES_EVENT,
    actor: { login: actor },
    payload: {
        action: 'closed',
        issue: { labels: labels.map((name) => ({ name })) },
    },
});

const staleCloseEvent = (actor) => makeCloseEvent({
    actor,
    labels: [LABEL_NAMES.STALE],
});

const nonStaleCloseEvent = (actor) => makeCloseEvent({
    actor,
    labels: [],
});

const makePrEvent = ({ action, mergedAt }) => ({
    type: EVENT_TYPES.PULL_REQUEST_EVENT,
    payload: {
        action,
        pull_request: {
            merged_at: mergedAt,
            user: { login: 'alice' },
        },
    },
});

describe('countEventsByType — pull request counters', () => {
    const contributor = {
        events: {
            [EVENT_TYPES.PULL_REQUEST_EVENT]: [
                makePrEvent({ action: 'opened', mergedAt: null }),
                makePrEvent({ action: 'opened', mergedAt: null }),
                makePrEvent({ action: 'closed', mergedAt: '2026-04-21T10:00:00Z' }),
                makePrEvent({ action: 'closed', mergedAt: '2026-04-21T11:00:00Z' }),
                makePrEvent({ action: 'closed', mergedAt: '2026-04-21T12:00:00Z' }),
            ],
        },
    };

    it('counts merged PRs as those with merged_at set', () => {
        expect(countEventsByType(contributor, EVENT_TYPES.MERGED_PULL_EVENT)).toBe(3);
    });

    it('counts new PRs as those without merged_at', () => {
        expect(countEventsByType(contributor, EVENT_TYPES.NEW_PULL_EVENT)).toBe(2);
    });

    it('returns 0 for merged PRs when contributor has no PR events', () => {
        expect(countEventsByType({ events: {} }, EVENT_TYPES.MERGED_PULL_EVENT)).toBe(0);
    });
});

describe('getCommitsCount', () => {
    it('counts every commit in a legacy PushEvent payload', () => {
        const events = [{ payload: { commits: [{ sha: 'a' }, { sha: 'b' }] } }];

        expect(getCommitsCount(events)).toBe(2);
    });

    it('falls back to one commit per push when the payload has no commits list', () => {
        const events = [{ payload: { head: 'sha' } }];

        expect(getCommitsCount(events)).toBe(1);
    });

    it('adds up commits across pushes', () => {
        const events = [
            { payload: { commits: [{ sha: 'a' }, { sha: 'b' }] } },
            { payload: { commits: [{ sha: 'c' }] } },
        ];

        expect(getCommitsCount(events)).toBe(3);
    });
});

describe('isMerged — reduced Events API payloads', () => {
    it('returns true for the merged action', () => {
        const event = { payload: { action: 'merged', pull_request: { number: 245751 } } };

        expect(isMerged(event)).toBe(true);
    });

    it('returns true for a closed event with merged_at', () => {
        const event = {
            payload: {
                action: 'closed',
                pull_request: { merged_at: '2026-11-01T10:00:00Z' },
            },
        };

        expect(isMerged(event)).toBe(true);
    });

    it('returns false for a closed event without merged_at', () => {
        const event = { payload: { action: 'closed', pull_request: { merged_at: null } } };

        expect(isMerged(event)).toBe(false);
    });
});

describe('isDecisionReview — submitted reviews only', () => {
    const reviewEvent = (action, state) => ({
        type: EVENT_TYPES.PULL_REQUEST_REVIEW_EVENT,
        payload: { action, review: { state } },
    });

    it.each(DECISION_REVIEW_STATES)(
        'returns true for a created review with state %s',
        (state) => {
            expect(isDecisionReview(reviewEvent('created', state))).toBe(true);
        },
    );

    it('returns false for an updated review', () => {
        expect(isDecisionReview(reviewEvent('updated', 'changes_requested'))).toBe(false);
    });

    it('returns false for a created review without a decision state', () => {
        expect(isDecisionReview(reviewEvent('created', 'pending'))).toBe(false);
    });

    it('returns false when the payload has no review', () => {
        expect(isDecisionReview({ payload: { action: 'created' } })).toBe(false);
    });
});

describe('getActivityAuthor — reduced pull_request payloads', () => {
    const reducedPullEvent = (action, actor) => ({
        type: EVENT_TYPES.PULL_REQUEST_EVENT,
        actor: { login: actor },
        payload: { action, pull_request: { id: 5001, number: 300 } },
    });

    it('credits the actor for an opened pull request without a user', () => {
        expect(getActivityAuthor(reducedPullEvent('opened', 'xglossyntx'))).toBe('xglossyntx');
    });

    it('credits the actor for a merged pull request without a user', () => {
        expect(getActivityAuthor(reducedPullEvent('merged', 'mu-hun'))).toBe('mu-hun');
    });

    it('does not credit a closed pull request that was not merged', () => {
        expect(getActivityAuthor(reducedPullEvent('closed', 'someone'))).toBeNull();
    });

    it('prefers the pull request author when the payload has a user', () => {
        const event = reducedPullEvent('opened', 'someone');
        event.payload.pull_request.user = { login: 'author' };

        expect(getActivityAuthor(event)).toBe('author');
    });
});

describe('getActivityAuthor — pull request reviews', () => {
    const reviewEvent = (action, state) => ({
        type: EVENT_TYPES.PULL_REQUEST_REVIEW_EVENT,
        actor: { login: 'reviewer' },
        payload: { action, review: { state } },
    });

    it('credits a submitted review with a decision', () => {
        expect(getActivityAuthor(reviewEvent('created', 'approved'))).toBe('reviewer');
    });

    it('does not credit an edited review', () => {
        expect(getActivityAuthor(reviewEvent('updated', 'changes_requested'))).toBeNull();
    });

    it('does not credit a review without a decision state', () => {
        expect(getActivityAuthor(reviewEvent('created', 'pending'))).toBeNull();
    });
});

describe('getActivityKey — reconcile identity', () => {
    it('keys a closed issue by issue id and close time', () => {
        const event = {
            type: EVENT_TYPES.ISSUES_EVENT,
            payload: {
                action: 'closed',
                issue: { id: 4001, closed_at: '2026-04-21T06:31:14Z' },
            },
        };

        expect(getActivityKey(event)).toBe('issue-4001-closed-2026-04-21T06:31:14Z');
    });

    it('keys a second closure of the same issue by its own close time', () => {
        const closeEvent = (closedAt) => ({
            type: EVENT_TYPES.ISSUES_EVENT,
            payload: { action: 'closed', issue: { id: 4001, closed_at: closedAt } },
        });

        // Reopen and close again: both closures are distinct activity.
        expect(getActivityKey(closeEvent('2026-04-21T06:31:14Z')))
            .not.toBe(getActivityKey(closeEvent('2026-04-21T18:00:00Z')));
    });

    it('falls back to the issue-only key when the payload has no close time', () => {
        const event = {
            type: EVENT_TYPES.ISSUES_EVENT,
            payload: { action: 'closed', issue: { id: 4001, closed_at: null } },
        };

        expect(getActivityKey(event)).toBe('issue-4001-closed');
    });

    it('keys opened and merged pull requests by pull id', () => {
        const opened = {
            type: EVENT_TYPES.PULL_REQUEST_EVENT,
            payload: { action: 'opened', pull_request: { id: 5001 } },
        };
        const merged = {
            type: EVENT_TYPES.PULL_REQUEST_EVENT,
            payload: { action: 'merged', pull_request: { id: 5001 } },
        };

        expect(getActivityKey(opened)).toBe('pr-5001-opened');
        expect(getActivityKey(merged)).toBe('pr-5001-merged');
    });

    it('returns null for activity that reconciliation does not recover', () => {
        const event = {
            type: EVENT_TYPES.PULL_REQUEST_EVENT,
            payload: { action: 'closed', pull_request: { id: 5001, merged_at: null } },
        };

        expect(getActivityKey(event)).toBeNull();
    });
});

describe('isClosedAsStale — close event partition', () => {
    it.each(EXCLUDED_USERNAMES)(
        'returns true for a %s close of a stale-labelled issue',
        (botLogin) => {
            expect(isClosedAsStale(staleCloseEvent(botLogin))).toBe(true);
        },
    );

    it('returns false for a human close of a stale-labelled issue', () => {
        expect(isClosedAsStale(staleCloseEvent('alice'))).toBe(false);
    });

    it('returns false for a bot close of a non-stale issue', () => {
        expect(isClosedAsStale(nonStaleCloseEvent(EXCLUDED_USERNAMES[0]))).toBe(false);
    });

    it('returns false for a human close of a non-stale issue', () => {
        expect(isClosedAsStale(nonStaleCloseEvent('alice'))).toBe(false);
    });
});

describe('getActivityAuthor — deleted pull request author', () => {
    it('falls back to the actor for a merged PR whose author was deleted', () => {
        const event = {
            type: EVENT_TYPES.PULL_REQUEST_EVENT,
            actor: { login: 'someone' },
            payload: {
                action: 'closed',
                pull_request: { merged_at: '2026-04-21T10:00:00Z', user: null },
            },
        };
        expect(() => getActivityAuthor(event)).not.toThrow();
        expect(getActivityAuthor(event)).toBe('someone');
    });

    it('falls back to the actor for an opened PR whose author was deleted', () => {
        const event = {
            type: EVENT_TYPES.PULL_REQUEST_EVENT,
            actor: { login: 'someone' },
            payload: {
                action: 'opened',
                pull_request: { merged_at: null, user: null },
            },
        };
        expect(getActivityAuthor(event)).toBe('someone');
    });
});

describe('getActivityAuthor — EXCLUDED_USERNAMES', () => {
    it('returns null for a push event from adguard-bot', () => {
        const event = {
            type: EVENT_TYPES.PUSH_EVENT,
            actor: { login: 'adguard-bot' },
            payload: { commits: [{ sha: 'abc' }] },
        };
        expect(getActivityAuthor(event)).toBeNull();
    });

    it('returns null for a closed-issue event from github-actions[bot]', () => {
        const event = {
            type: EVENT_TYPES.ISSUES_EVENT,
            actor: { login: 'github-actions[bot]' },
            payload: {
                action: 'closed',
                issue: { labels: [] },
            },
        };
        expect(getActivityAuthor(event)).toBeNull();
    });

    it('returns the actor for a human close of a stale-labelled issue', () => {
        const event = {
            type: EVENT_TYPES.ISSUES_EVENT,
            actor: { login: 'alice' },
            payload: {
                action: 'closed',
                issue: { labels: [{ name: LABEL_NAMES.STALE }] },
            },
        };
        expect(getActivityAuthor(event)).toBe('alice');
    });
});
