# @adguard/github-stats

A command-line toolkit that collects repository activity from the GitHub
Events API, stores it as daily JSONL files, and produces per-contributor
statistics for any time window. Reports can be printed to the console or
published to a Slack channel as formatted messages.

It is designed for teams that want to track and share contributor activity
in a GitHub repository without relying on the GitHub web interface.

## What it does

The toolkit provides three CLI commands:

- **`github-poll`** — fetches the latest events from the GitHub REST API,
  deduplicates them, and appends them to a local JSONL collection (one file
  per day).
- **`github-stats`** — reads the stored events for a given time window,
  aggregates per-contributor activity, and prints the results to the
  console.
- **`github-publish`** — computes the same statistics and posts them to a
  Slack channel using Block Kit formatted messages.

Typical usage is to schedule `github-poll` frequently (e.g. every hour via
GitHub Actions) so that no events are lost, then run `github-stats` or
`github-publish` on demand or on a schedule to generate reports.

## Concepts

### <a id="activity_count"> Activity points

An activity point is counted for each of the following user actions:

- Commit added to the default branch.
- Issue closed (unless closed by a bot).
- Comment added to an Issue or Pull Request.
- Pull request review submitted with a decision (approved, changes
  requested, or commented).
- Pull request merged, credited to the author.

### Daily JSONL storage

Events are stored as one JSONL file per day (`YYYY-MM-DD.jsonl`) under
`COLLECTION_PATH`. A companion metadata file (`YYYY-MM-DD-metadata.json`)
tracks how many events were fetched, how many were written after
deduplication, and rate-limit status.

### Time window

`github-stats` and `github-publish` operate on a time window defined by
`SINCE` and `UNTIL`. If `SINCE` is omitted, all stored events are used.
If `UNTIL` is omitted, the current time is used. Daily files older than
30 days are automatically pruned during `github-poll`.

### Stats accuracy

`github-stats` and `github-publish` read commit activity from the GitHub
REST commits endpoint (`GET /repos/{owner}/{repo}/commits`) for the
requested window. The Events API no longer includes the commits list in
`PushEvent` payloads, so stored events cannot show who authored a commit
or how many commits a push contains. The REST endpoint attributes each
commit to its author and counts one activity point per commit. Commits
without a linked GitHub author or without a committer date are skipped.
When the request fails, the tools emit a warning and fall back to counting
one commit per stored `PushEvent`.

Pull request events can also have a reduced payload: opened and merged
pull requests may omit the author, and a merged pull request arrives as
`action: "merged"` without `merged_at`. The tools count both the
`merged` action and `closed` with `merged_at`, credit the pull request to
`pull_request.user.login` when it is present, and fall back to the event
actor otherwise. GitHub sets the actor of a reduced `merged` event to the
pull request author.

A review adds an activity point only when it is submitted with a decision
(approved, changes requested, or commented). An edit of an existing
review does not add a point.

Both tools also perform a **reconciliation** against the GitHub REST API
for the requested window when `RECONCILE=true`. This recovers issue
closures and PR open/merge events that were missed by the Events-API
poller (the Events API only retains the 300 most recent public events).
The reconciliation stops at a 3-minute budget and emits a warning when it
cannot cover the whole window. When the REST API is unavailable or the
reconciliation is truncated, the tools emit a warning; if the window is
also empty in the local collection they exit non-zero rather than
producing an under-reported message.

Per-poll diagnostics are appended to `<date>-metadata.json` (one
record per poll) so polling gaps can be analyzed after the fact.

## <a id="how-to-install"></a> Installation

The package is no longer distributed via npm — install and build from
source:

```bash
git clone https://github.com/AdguardTeam/AdGuardFiltersStats.git
cd AdGuardFiltersStats
yarn install
yarn build
```

The commands are then available through the `yarn` scripts `yarn poll`,
`yarn stats`, and `yarn run publish`.

## Quick start

1. Set the required environment variables:

    ```bash
    export COLLECTION_PATH=./stats-data
    export REPO=AdguardTeam/AdguardFilters
    export GITHUB_TOKEN=ghp_xxx
    ```

2. Poll today's events:

    ```bash
    yarn poll
    ```

3. Print stats for the last week:

    ```bash
    export SINCE=2025-05-01T00:00:00Z
    export UNTIL=2025-05-08T00:00:00Z
    yarn stats
    ```

## Usage

### Poll events

```bash
yarn poll
```

Required variables: `COLLECTION_PATH`, `REPO`.
Recommended variable: `GITHUB_TOKEN` (without it the GitHub API limits
unauthenticated requests to 60 per hour).

Each run fetches the most recent events from the GitHub Events API,
removes duplicates already present in today's JSONL file, and appends
new ones. The metadata sidecar is updated in place. Re-running on the
same day is safe and idempotent.

An Events API page request that fails with a transient error is retried
up to three times with exponential backoff before the poll fails. A rate
limit response is not retried and reports when the limit resets or how
long to wait. GitHub API requests time out after 30 seconds by default.
A gap reconciliation request can time out sooner when the remaining
budget is smaller than 30 seconds.

When a poll gap is detected, `github-poll` backfills the gap from the
GitHub REST API within a 3-minute budget. Each page is logged. The
backfill stops with a warning when the budget is spent, and the collected
events are still committed. A slow reconciliation thus does not lose the
poll batch. A failed backfill is retried on the next poll, and a backfill
that stops at the time budget is retried too: the next poll measures the
gap from the previous successful poll. The metadata records
`backfillTruncated: true` for a backfill that stopped at the budget or the
30-page limit, and `backfillBudgetExceeded: true` for the budget case. A
page-limit truncation is not retried, because the REST walks always
restart from the newest page and a retry cannot reach the un-walked tail.

A retried backfill can overlap events that are already stored. Synthetic
events whose activity key is already present in the collection are
skipped, so a retry does not count one closure or pull request twice.

#### Metadata fields

The `YYYY-MM-DD-metadata.json` sidecar contains a JSON **array** of records, one per
poll run. (Legacy files written as a single object are automatically migrated to an array
on the next poll.)

| Field                    | Description                                                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `timestamp`              | ISO 8601 time when this poll ran                                                                                                 |
| `totalEvents`            | Events fetched from GitHub API                                                                                                   |
| `eventsInFile`           | Unique events written after deduplication                                                                                        |
| `pagesCollected`         | Number of API pages processed                                                                                                    |
| `rateLimitReached`       | Whether the API rate limit was hit                                                                                               |
| `rateLimitRemaining`     | Remaining API requests at poll time                                                                                              |
| `rateLimitReset`         | ISO 8601 timestamp when the rate limit resets                                                                                    |
| `oldestEventAt`          | `created_at` of the oldest event returned by this poll                                                                           |
| `newestEventAt`          | `created_at` of the newest event returned by this poll                                                                           |
| `gapSuspected`           | `true` if no successful poll for >90 min (a failed or budget-stopped backfill does not count) or an event-window gap is detected |
| `backfillTruncated`      | `true` if a gap backfill stopped early (time budget or page limit)                                                               |
| `backfillBudgetExceeded` | `true` if the time budget, rather than the page limit, stopped a backfill                                                        |
| `backfillError`          | Reconciliation error message if the backfill failed, otherwise `null`                                                            |
| `error`                  | Error message if the poll failed, otherwise `null`                                                                               |

### Print stats in console

```bash
yarn stats
```

Required variables: `COLLECTION_PATH`, `REPO`.
Optional variables: `SINCE`, `UNTIL`, `GITHUB_TOKEN`.

Outputs a table of contributors ranked by activity points within the
specified time window, plus a repository summary (new issues, closed
issues, new and merged pull requests, etc.).

### Publish stats to Slack

```bash
yarn run publish
```

Required variables: `COLLECTION_PATH`, `REPO`, `SLACK_OAUTH_TOKEN`,
`SLACK_CHANNEL_ID`.
Optional variables: `SINCE`, `UNTIL`, `GITHUB_TOKEN`.

Posts the same statistics as `github-stats` to the configured Slack
channel. Team members are always included; external contributors only
appear if their activity points are at or above the
`MIN_REQUIRED_ACTIVITY` threshold defined in the source code.

## Configuration

All configuration is provided through environment variables. The CLI
entries load a `.env` file from the working directory if one exists.

### Common variables

| Variable          | Required for                             | Description                                                                                                                                                                      |
| ----------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `COLLECTION_PATH` | All commands                             | Directory for daily JSONL files and metadata sidecars.                                                                                                                           |
| `REPO`            | All commands                             | Target repository in `owner/repo_name` form.                                                                                                                                     |
| `GITHUB_TOKEN`    | `poll` (recommended), `stats`, `publish` | GitHub Personal Access Token. Raises the API rate limit from 60 to 5000 requests per hour.                                                                                       |
| `SINCE`           | `stats`, `publish`                       | Lower bound of the time window (ISO 8601). All stored events are used if omitted.                                                                                                |
| `UNTIL`           | `stats`, `publish`                       | Upper bound of the time window (ISO 8601). Defaults to now if omitted.                                                                                                           |
| `RECONCILE`       | —                                        | Set to `true` to back-fill missing issue and PR events from the GitHub REST API during `stats`/`publish`. Commit activity is read from the REST API. Disabled by default.        |

`RECONCILE` reconciliation stops at a 3-minute budget. When the budget is
spent, the tools warn that the report may under-report.

### Publishing variables

| Variable            | Required for | Description                           |
| ------------------- | ------------ | ------------------------------------- |
| `SLACK_OAUTH_TOKEN` | `publish`    | Slack bot token (`xoxb-...`).         |
| `SLACK_CHANNEL_ID`  | `publish`    | Slack channel ID to post messages to. |

## Scheduling with GitHub Actions

Example workflows for polling, printing, and publishing are available in
the [examples](examples) directory. A typical setup runs `github-poll`
every hour to avoid losing events (the GitHub Events API returns at most
300 recent events per repository), and runs `github-publish` once a day
to post a summary.

## Documentation

- [Development guide](DEVELOPMENT.md) — local setup, build, test, and
  contribution workflow.
- [LLM agent rules](AGENTS.md) — coding conventions, architecture, and
  project structure.
- [Changelog](CHANGELOG.md) — release history.
