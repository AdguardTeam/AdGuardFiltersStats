import { getClosedIssuesInWindow, getPullsInWindow } from './gh-utils';

const epochMs = (iso) => new Date(iso).getTime();

const issueClosedEvent = (issue, repo) => {
    if (!issue.closed_by || !issue.closed_by.login) {
        return null;
    }
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
    if (!pr.user || !pr.user.login) {
        return null;
    }
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
    if (!pr.merged_at || !pr.user || !pr.user.login) {
        return null;
    }
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
 *
 * @param {{
 *   closedIssues: Array,
 *   pulls: Array,
 *   repo: Object,
 *   timePeriod: {since: string, until: string}
 * }} params
 */
export const buildSyntheticEvents = ({
    closedIssues, pulls, repo, timePeriod,
}) => {
    const { since, until } = timePeriod;
    const sinceMs = new Date(since).getTime();
    const untilMs = new Date(until).getTime();
    const events = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const issue of closedIssues) {
        const ev = issueClosedEvent(issue, repo);
        if (ev) {
            events.push(ev);
        }
    }
    // eslint-disable-next-line no-restricted-syntax
    for (const pr of pulls) {
        // Only emit an opened event when the PR was created within the window.
        // getPullsInWindow also returns PRs opened before `since` that were
        // merged in the window; emitting an opened event for those would inject
        // historical data outside the reporting period.
        const createdMs = new Date(pr.created_at).getTime();
        if (createdMs >= sinceMs && createdMs <= untilMs) {
            const opened = prOpenedEvent(pr, repo);
            if (opened) {
                events.push(opened);
            }
        }
        const merged = prMergedEvent(pr, repo);
        if (merged) {
            events.push(merged);
        }
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
    const [issuesResult, pullsResult] = await Promise.allSettled([
        getClosedIssuesInWindow(commonRequestData, timePeriod),
        getPullsInWindow(commonRequestData, timePeriod),
    ]);
    const closedIssues = issuesResult.status === 'fulfilled' ? issuesResult.value : [];
    const pulls = pullsResult.status === 'fulfilled' ? pullsResult.value : [];
    const restRequestsMade = [issuesResult, pullsResult]
        .filter((r) => r.status === 'fulfilled').length;
    const errors = [issuesResult, pullsResult]
        .filter((r) => r.status === 'rejected')
        .map((r) => r.reason.message);
    const error = errors.length > 0 ? errors.join('; ') : null;
    return {
        injectedEvents: buildSyntheticEvents({
            closedIssues, pulls, repo: repoMeta, timePeriod,
        }),
        restRequestsMade,
        error,
    };
};
