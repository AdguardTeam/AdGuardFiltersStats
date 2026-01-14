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
];

/**
 * Usernames to exclude from stats.
 */
export const EXCLUDED_USERNAMES = [
    'adguard-bot',
    'github-actions[bot]',
];

export const README_URL = 'https://github.com/AdguardTeam/AdGuardFiltersStats#github-stats-cli-app';

export const MILLISECONDS_IN_DAY = 1000 * 60 * 60 * 24;
export const EVENT_EXPIRATION_DAYS = 30;
export const ENDPOINTS = {
    ISSUES: 'GET /repos/{owner}/{repo}/issues',
    GITHUB_EVENTS: 'GET /repos/{owner}/{repo}/events',
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
};

export const COLLECTION_FILE_EXTENSION = '.jsonl';

/**
 * Maximum number of most recent events to collect.
 *
 * GitHub Events API only returns up to 300 most recent events.
 */
export const MAX_NUMBER_OF_MOST_RECENT_EVENTS = 300;
