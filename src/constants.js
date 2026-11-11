/**
 * Minimum activity points required for a contributor to appear in Slack reports.
 *
 * Team members are always included regardless of this threshold.
 */
export const MIN_REQUIRED_ACTIVITY = 5;

/**
 * AdGuard filters maintainers.
 *
 * @see {@link https://github.com/orgs/AdguardTeam/teams/filters-maintainers}
 */
export const TEAM_MEMBERS = [
    'Alex-302',
    'Sergey-Lyapin',
    'AdamWr',
    'zloyden',
    'BlazDT',
    'piquark6046',
    'ntnguyen1234',
    'ghajini',
    'mu-hun',
];

/**
 * Usernames to exclude from stats.
 */
export const EXCLUDED_USERNAMES = [
    'adguard-bot',
    'github-actions[bot]',
];

export const README_URL = 'https://github.com/AdguardTeam/AdGuardFiltersStats#activity_count';

export const MILLISECONDS_IN_DAY = 1000 * 60 * 60 * 24;
export const EVENT_EXPIRATION_DAYS = 30;

/**
 * Minimum time (ms) between two polls with successful backfills before a gap
 * is suspected.
 *
 * 90 minutes — exceeds the recommended 60-min poll cadence but stays below
 * the point where the GitHub Events API (300-event cap) would start losing data.
 */
export const POLL_GAP_THRESHOLD_MS = 90 * 60 * 1000;

/**
 * Time budget (ms) for one gap reconciliation.
 *
 * The poll step has a 10-minute timeout, and the Events API walk can take
 * about 381 s in the worst case: three pages, each with four attempts of
 * 30 s plus 7 s of backoff. 180 s leaves about 39 s of the step for the
 * rest of the poll, so a slow reconciliation stops before the step timeout
 * and the collected events are still committed. The stats and publish
 * steps have a 15-minute timeout, so the same budget fits them too.
 */
export const RECONCILE_BUDGET_MS = 180 * 1000;

export const ENDPOINTS = {
    ISSUES: 'GET /repos/{owner}/{repo}/issues',
    GITHUB_EVENTS: 'GET /repos/{owner}/{repo}/events',
    COMMITS: 'GET /repos/{owner}/{repo}/commits',
};

export const EVENT_TYPES = {
    ISSUES_EVENT: 'IssuesEvent',
    ISSUE_COMMENT_EVENT: 'IssueCommentEvent',
    PULL_REQUEST_EVENT: 'PullRequestEvent',
    PULL_REQUEST_REVIEW_EVENT: 'PullRequestReviewEvent',
    PUSH_EVENT: 'PushEvent',
    // These don't represent GitHub API event types
    NEW_PULL_EVENT: 'newPullEvent',
    MERGED_PULL_EVENT: 'mergePullEvent',
};

export const LABEL_NAMES = {
    STALE: 'Stale',
};

export const ACTION_NAMES = {
    OPENED: 'opened',
    CLOSED: 'closed',
    MERGED: 'merged',
    CREATED: 'created',
};

/**
 * Pull request review states that count as a review decision.
 *
 * A review with one of these states gives an activity point to the reviewer.
 * Other states, such as `pending`, do not.
 */
export const DECISION_REVIEW_STATES = [
    'approved',
    'changes_requested',
    'commented',
];

export const COLLECTION_FILE_EXTENSION = '.jsonl';

/**
 * Maximum number of most recent events to collect.
 *
 * GitHub Events API only returns up to 300 most recent events.
 */
export const MAX_NUMBER_OF_MOST_RECENT_EVENTS = 300;
