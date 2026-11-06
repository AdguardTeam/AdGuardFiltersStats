jest.mock('@octokit/core', () => {
    const requests = [];
    const makeCommit = (sha, date) => ({
        sha,
        author: { id: 1, login: 'alice' },
        commit: {
            message: `message ${sha}`,
            author: { name: 'alice', date },
            committer: { date },
        },
        parents: [],
    });
    const pages = {
        1: {
            headers: { link: '<https://api.github.com/repositories/1/commits?page=2>; rel="next"' },
            data: [
                makeCommit('sha-1', '2026-11-01T10:00:00Z'),
                makeCommit('sha-2', '2026-11-01T12:00:00Z'),
            ],
        },
        2: {
            headers: {},
            data: [
                // Same SHA on a later page must be collapsed.
                makeCommit('sha-1', '2026-11-01T10:00:00Z'),
                // Outside the requested window must be dropped.
                makeCommit('sha-3', '2026-10-31T23:00:00Z'),
                makeCommit('sha-4', '2026-11-01T20:00:00Z'),
            ],
        },
    };
    const Octokit = jest.fn().mockImplementation(() => ({
        request: jest.fn(async (endpoint, params) => {
            requests.push({ endpoint, params });
            if (Octokit.endless) {
                return {
                    headers: { link: '<https://api.github.com/repositories/1/commits?page=2>; rel="next"' },
                    data: [makeCommit(`endless-${params.page}`, '2026-11-01T10:00:00Z')],
                };
            }
            return pages[params.page] || { headers: {}, data: [] };
        }),
    }));
    Octokit.requests = requests;
    Octokit.endless = false;
    return { Octokit };
});

// eslint-disable-next-line import/first
import { getCommitsInWindow } from '../../src/tools/gh-utils';

const window = { since: '2026-11-01T00:00:00Z', until: '2026-11-01T23:59:59Z' };

const getClientMock = () => {
    // eslint-disable-next-line global-require
    const { Octokit } = require('@octokit/core');
    return Octokit;
};

const getRequests = () => getClientMock().requests;

describe('getCommitsInWindow', () => {
    beforeEach(() => {
        getRequests().length = 0;
        getClientMock().endless = false;
    });

    it('walks pages, collapses duplicate SHAs, and drops out-of-window commits', async () => {
        const commits = await getCommitsInWindow({ owner: 'o', repo: 'r' }, window);

        expect(commits.map((c) => c.sha)).toEqual(['sha-1', 'sha-2', 'sha-4']);
    });

    it('requests commits of the default branch with the window and page size', async () => {
        await getCommitsInWindow({ owner: 'o', repo: 'r' }, window);

        const requests = getRequests();
        expect(requests).toHaveLength(2);
        expect(requests[0].endpoint).toBe('GET /repos/{owner}/{repo}/commits');
        expect(requests[0].params).toMatchObject({
            owner: 'o',
            repo: 'r',
            since: '2026-11-01T00:00:00.000Z',
            until: '2026-11-01T23:59:59.000Z',
            per_page: 100,
            page: 1,
        });
        expect(requests[0].params.request.signal).toBeInstanceOf(AbortSignal);
        expect(requests[1].params.page).toBe(2);
    });

    it('fails instead of returning a truncated list when the page limit is reached', async () => {
        getClientMock().endless = true;

        await expect(getCommitsInWindow({ owner: 'o', repo: 'r' }, window))
            .rejects.toThrow(/exceeds 300 pages/);
    });

    it('defaults the upper bound to now when until is omitted', async () => {
        const before = Date.now();
        await getCommitsInWindow({ owner: 'o', repo: 'r' }, { since: window.since });
        const after = Date.now();

        const [{ params }] = getRequests();
        const until = new Date(params.until).getTime();
        expect(until).toBeGreaterThanOrEqual(before);
        expect(until).toBeLessThanOrEqual(after);
    });
});
