import { getClosedIssuesInWindow, getPullsInWindow } from './gh-utils';

const epochMs = (iso) => new Date(iso).getTime();

const issueClosedEvent = (issue, repo) => {
    if (!issue.closed_by || !issue.closed_by.login) return null;
    return {
        id: `synthetic-issue-closed-${issue.id}-${epochMs(issue.closed_at)}`,
        type: 'IssuesEvent',
        actor: { id: issue.closed_by.id, login: issue.closed_by.login },
        repo,
        payload: { action: 'closed', issue },
        created_at: issue.closed_at,
    };
};

const prOpenedEvent = (pr, repo) => {
    if (!pr.user || !pr.user.login) return null;
    return {
        id: `synthetic-pr-opened-${pr.id}`,
        type: 'PullRequestEvent',
        actor: { id: pr.user.id, login: pr.user.login },
        repo,
        payload: {
            action: 'opened',
            pull_request: { ...pr, merged_at: null },
        },
        created_at: pr.created_at,
    };
};

const prMergedEvent = (pr, repo) => {
    if (!pr.merged_at || !pr.user || !pr.user.login) return null;
    return {
        id: `synthetic-pr-merged-${pr.id}`,
        type: 'PullRequestEvent',
        actor: { id: pr.user.id, login: pr.user.login },
        repo,
        payload: { action: 'closed', pull_request: pr },
        created_at: pr.merged_at,
    };
};

/**
 * Convert REST payloads into synthetic events that match the live
 * Events-API shape consumed by the rest of the pipeline.
 */
export const buildSyntheticEvents = ({ closedIssues, pulls, repo }) => {
    const events = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const issue of closedIssues) {
        const ev = issueClosedEvent(issue, repo);
        if (ev) events.push(ev);
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const pr of pulls) {
        const opened = prOpenedEvent(pr, repo);
        if (opened) events.push(opened);
        const merged = prMergedEvent(pr, repo);
        if (merged) events.push(merged);
    }
    return events;
};

/**
 * Fetch REST data for the window and return synthetic events plus a
 * diagnostic record. Never throws — REST failure surfaces in `error`.
 *
 * @param {{owner: string, repo: string}} commonRequestData
 * @param {{since: string, until: string}} timePeriod
 * @param {{id: number, name: string}} repoMeta
 */
export const reconcileWindow = async (commonRequestData, timePeriod, repoMeta) => {
    try {
        const [closedIssues, pulls] = await Promise.all([
            getClosedIssuesInWindow(commonRequestData, timePeriod),
            getPullsInWindow(commonRequestData, timePeriod),
        ]);
        return {
            injectedEvents: buildSyntheticEvents({ closedIssues, pulls, repo: repoMeta }),
            restRequestsMade: 2,
            error: null,
        };
    } catch (error) {
        return { injectedEvents: [], restRequestsMade: 0, error: error.message };
    }
};
