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

- Commit pushed.
- Issue closed (unless marked as *Stale*).
- Comment added to an Issue or Pull Request.
- Pull Request review (approved or rejected).
- Pull Request merged.

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

## <a id="how-to-install"></a> Installation

Install globally via npm:

```bash
npm i -g @adguard/github-stats
```

Or run with npx without installing:

```bash
npx @adguard/github-stats <command>
```

## Quick start

1. Set the required environment variables:

    ```bash
    export COLLECTION_PATH=./stats-data
    export REPO=AdguardTeam/AdguardFilters
    export GITHUB_TOKEN=ghp_xxx
    ```

2. Poll today's events:

    ```bash
    github-poll
    ```

3. Print stats for the last week:

    ```bash
    export SINCE=2025-05-01T00:00:00Z
    export UNTIL=2025-05-08T00:00:00Z
    github-stats
    ```

## Usage

### Poll events

```bash
github-poll
```

Required variables: `COLLECTION_PATH`, `REPO`.
Recommended variable: `GITHUB_TOKEN` (without it the GitHub API limits
unauthenticated requests to 60 per hour).

Each run fetches the most recent events from the GitHub Events API,
removes duplicates already present in today's JSONL file, and appends
new ones. The metadata sidecar is updated in place. Re-running on the
same day is safe and idempotent.

#### Metadata fields

| Field                | Description                               |
| -------------------- | ----------------------------------------- |
| `totalEvents`        | Events fetched from GitHub API            |
| `eventsWritten`      | Unique events written after deduplication |
| `pagesCollected`     | Number of API pages processed             |
| `rateLimitReached`   | Whether the API rate limit was hit        |
| `rateLimitRemaining` | Remaining API requests                    |
| `rateLimitReset`     | Timestamp when the rate limit resets      |

### Print stats in console

```bash
github-stats
```

Required variables: `COLLECTION_PATH`, `REPO`.
Optional variables: `SINCE`, `UNTIL`, `GITHUB_TOKEN`.

Outputs a table of contributors ranked by activity points within the
specified time window, plus a repository summary (new issues, closed
issues, new and merged pull requests, etc.).

### Publish stats to Slack

```bash
github-publish
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

| Variable          | Required for                  | Description                                                                                |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `COLLECTION_PATH` | All commands                  | Directory for daily JSONL files and metadata sidecars.                                     |
| `REPO`            | All commands                  | Target repository in `owner/repo_name` form.                                               |
| `GITHUB_TOKEN`    | `poll` (recommended), `stats`, `publish` | GitHub Personal Access Token. Raises the API rate limit from 60 to 5000 requests per hour. |
| `SINCE`           | `stats`, `publish`            | Lower bound of the time window (ISO 8601). All stored events are used if omitted.          |
| `UNTIL`           | `stats`, `publish`            | Upper bound of the time window (ISO 8601). Defaults to now if omitted.                     |

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
