import { countEventsByType, getActivityAuthor } from '../../src/tools/events-utils';
import { EVENT_TYPES } from '../../src/constants';

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

describe('getActivityAuthor — null/deleted actor', () => {
    it('returns undefined for a merged PR whose author was deleted', () => {
        const event = {
            type: EVENT_TYPES.PULL_REQUEST_EVENT,
            actor: { login: 'someone' },
            payload: {
                action: 'closed',
                pull_request: { merged_at: '2026-04-21T10:00:00Z', user: null },
            },
        };
        expect(() => getActivityAuthor(event)).not.toThrow();
        expect(getActivityAuthor(event)).toBeUndefined();
    });

    it('returns undefined for an opened PR whose author was deleted', () => {
        const event = {
            type: EVENT_TYPES.PULL_REQUEST_EVENT,
            actor: { login: 'someone' },
            payload: {
                action: 'opened',
                pull_request: { merged_at: null, user: null },
            },
        };
        expect(getActivityAuthor(event)).toBeUndefined();
    });
});
