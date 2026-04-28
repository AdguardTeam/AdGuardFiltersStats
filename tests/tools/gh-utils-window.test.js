jest.mock('@octokit/core', () => {
    const requests = [];
    const Octokit = jest.fn().mockImplementation(() => ({
        request: jest.fn(async (endpoint, params) => {
            requests.push({ endpoint, params });
            // Return a single page based on the endpoint and params
            if (endpoint.includes('/issues')) {
                return {
                    headers: {},
                    data: [
                        {
                            id: 1,
                            number: 100,
                            closed_at: '2026-04-21T10:00:00Z',
                            closed_by: { login: 'alice' },
                            labels: [],
                            pull_request: undefined,
                        },
                        // pull_request key indicates a PR — must be filtered out
                        {
                            id: 2,
                            number: 101,
                            closed_at: '2026-04-21T11:00:00Z',
                            closed_by: { login: 'bob' },
                            labels: [],
                            pull_request: { url: 'x' },
                        },
                        // out of window
                        {
                            id: 3,
                            number: 102,
                            closed_at: '2026-04-19T10:00:00Z',
                            closed_by: { login: 'alice' },
                            labels: [],
                            pull_request: undefined,
                        },
                    ],
                };
            }
            if (endpoint.includes('/pulls')) {
                return {
                    headers: {},
                    data: [
                        {
                            id: 10,
                            number: 200,
                            created_at: '2026-04-21T08:00:00Z',
                            merged_at: '2026-04-21T09:00:00Z',
                            updated_at: '2026-04-21T09:00:00Z',
                            user: { login: 'alice', id: 1 },
                        },
                        {
                            id: 11,
                            number: 201,
                            created_at: '2026-04-21T09:00:00Z',
                            merged_at: null,
                            updated_at: '2026-04-21T09:00:00Z',
                            user: { login: 'bob', id: 2 },
                        },
                        // out-of-window: updated_at older than since by a wide margin → stop
                        {
                            id: 12,
                            number: 202,
                            created_at: '2026-04-15T08:00:00Z',
                            merged_at: null,
                            updated_at: '2026-04-15T08:00:00Z',
                            user: { login: 'eve', id: 3 },
                        },
                    ],
                };
            }
            return { headers: {}, data: [] };
        }),
    }));
    // eslint-disable-next-line no-underscore-dangle
    Octokit.__requests = requests;
    return { Octokit };
});

// eslint-disable-next-line import/first
import {
    getClosedIssuesInWindow, getPullsInWindow,
} from '../../src/tools/gh-utils';

const window = { since: '2026-04-21T00:00:00Z', until: '2026-04-21T23:59:59Z' };

describe('REST window helpers', () => {
    it('getClosedIssuesInWindow returns only true issues with closed_at in [since,until]', async () => {
        const issues = await getClosedIssuesInWindow({ owner: 'o', repo: 'r' }, window);
        expect(issues.map((i) => i.number)).toEqual([100]);
    });

    it('getPullsInWindow returns PRs touched within the window', async () => {
        const pulls = await getPullsInWindow({ owner: 'o', repo: 'r' }, window);
        expect(pulls.map((p) => p.number).sort()).toEqual([200, 201]);
    });
});
