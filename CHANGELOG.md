# GitHub Stats CLI App Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog], and this project adheres to [Semantic Versioning].

[Keep a Changelog]: https://keepachangelog.com/en/1.0.0/
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html

## Unreleased

### Fixed

- `github-poll` no longer fails when one event has an unreadable
  `created_at`. The poll skips such an event, warns with the count, and
  records the batch bounds from the events it can read. A batch without a
  readable event time uses the poll time instead. The metadata record holds
  the count in `skippedEvents`.
- An empty events batch is now a successful poll: it records its metadata,
  runs the stale-file cleanup, and exits with code 0. `github-poll` logs the
  empty result as information, not as a warning.
- `github-poll`, `github-stats`, and `github-publish` now validate the
  required environment variables before they start, and report a failure
  with one line and exit code 1 instead of a stack trace.
  `github-publish` also requires `SLACK_OAUTH_TOKEN` and
  `SLACK_CHANNEL_ID`. The message names the variables that are absent.
  `REPO` must be in `owner/repo_name` form.
- The CLI entries now load `.env` before any module that reads
  `process.env` at import time, so a `GITHUB_TOKEN` from `.env` alone
  authenticates the bundled commands.
- `github-poll` reports a failed poll on one line instead of a second
  error line and a multi-line metadata dump.
- A Slack failure now rejects `publishMessage()` and `replyMessage()`, so
  `github-publish` reports the Slack reason on one line and exits non-zero
  instead of crashing on `undefined` or exiting 0 after a failed reply.
- `github-stats` without `SINCE` now reads every stored day, as
  documented, instead of failing with `Invalid interval`.
  `github-publish` keeps its previous-calendar-day defaults. `RECONCILE`
  needs `SINCE` and is ignored with a warning otherwise. The commits
  request also needs `SINCE`, so a run without it warns before it falls
  back to one commit per stored `PushEvent`.
- `github-poll` now removes a metadata sidecar together with its day file
  when the day is older than `EVENT_EXPIRATION_DAYS`, so the sidecars no
  longer accumulate without limit. The first poll after upgrading also
  removes the sidecars that earlier versions left behind; keep a copy
  outside the collection if that history is needed.
- `github-poll` now stops a gap reconciliation at a 3-minute budget, so a
  slow REST backfill cannot overrun the poll step timeout and the collected
  events are still committed. A failed backfill and a backfill that stops at
  the time budget do not count as the last successful poll, so the next poll
  retries them. The last successful poll is now read from the current and
  the previous day metadata sidecar, so a gap that crosses midnight is
  detected and a failed backfill from the previous day is retried. A poll
  that finds no successful record in either sidecar warns instead of
  skipping the gap silently. A
  page-limit truncation is recorded but not retried. Each page is logged,
  and the poll metadata records `backfillTruncated`,
  `backfillBudgetExceeded`, and `backfillError`.
- A retried backfill no longer stores a synthetic event when the same
  activity is already present in the collection as a live event.
- `github-stats` and `github-publish` now exit non-zero instead of
  printing a zero report when reconciliation is truncated and the local
  window is empty.
- `github-stats` and `github-publish` with `RECONCILE=true` now use the same
  3-minute budget and warn when reconciliation cannot cover the whole
  window.
- `github-poll`, `github-stats`, and `github-publish` now keep the events
  that a reconciliation walk recovers when the other walk fails.
  `github-poll` still does not count the failed backfill as a successful
  poll, so the next poll retries the window, and a repeated event is not
  counted twice. A failure to store the recovered events is a warning, not
  a command failure, and the poll records it as the retry reason.
- A failed write to the collection no longer crashes the process with an
  unhandled stream `error` (for example `EACCES` on a read-only collection).
  `github-poll` records the failed poll and exits non-zero, and
  `github-stats` and `github-publish` keep producing the report from the
  events they already hold.
- `github-poll` now validates the `newestEventAt` and `timestamp` of the last
  successful poll before it compares them, and falls back to the other value
  when one is unreadable, so an unreadable value no longer disables the gap
  check. The poll warns for each fallback, and warns that the gap check is
  skipped when neither value is readable. A backfill still starts only when
  the window is missing.
- Stored poll metadata and the poll logs now hold each error reason on one
  line of at most 300 characters, so a multi-line API response can no longer
  break a log line or bloat a committed metadata record. A field that joins
  several reasons bounds each reason, not the joined text. The stored reason
  is never empty: a failure without readable text is stored with its HTTP
  status, so the next poll still treats that window as failed and retries it.
- A real GitHub API error that arrives as the request timeout fires now keeps
  its own message and status. A budget-capped reconciliation walk no longer
  reports such an error as a budget stop.

## 1.1.5

### Changed

- `github-poll` now requests 100 events per page from the GitHub Events API,
  so a full walk takes three requests instead of ten and `pagesCollected` in
  the run metadata reports 3 instead of 10.

## 1.1.4

### Fixed

- GitHub API requests now time out after 30 seconds, so a stalled
  response fails instead of keeping the command hanging. The error says
  that the request timed out.
- `github-poll` now retries a failed GitHub Events API page request up to
  three times with exponential backoff. A transient network error or a
  truncated response body no longer aborts the whole poll.
- A rate limit response is not retried, and the error reports when the
  limit resets or how long to wait.

## 1.1.3

### Fixed

- Commit activity for a reporting window is now read from the GitHub
  REST commits endpoint and credited to the commit author. The Events API
  no longer includes the commits list in `PushEvent` payloads, so the
  previous logic counted a whole push as one commit for the pusher and
  dropped commits that another user pushed.
- Pull request activity is now counted from reduced Events API payloads.
  Merged pull requests arrive with action `merged` and no `merged_at` or
  author, so the previous logic did not detect them. A pull request is
  credited to the author when the payload has one, and to the event actor
  otherwise ([#4]).
- A pull request review now counts only when it is submitted with a
  decision (approved, changes requested, or commented). An edit of an
  existing review no longer adds an activity point
  ([#4]).

[#4]: https://github.com/AdguardTeam/AdGuardFiltersStats/issues/4

## v1.1.2

### Fixed

- Upgraded `@slack/web-api` from 7.15.1 to 8.1.1, removing the transitive `axios`
  dependency and addressing CVE-2026-44486 (proxy credential disclosure via
  HTTP redirects).

## v1.1.1

### Fixed

- "Closed as stale" metric now counts only stale-labelled issues that were
  closed by the stale bot (`adguard-bot`, `github-actions[bot]`). All other
  closes — including stale-labelled issues closed manually by maintainers —
  are counted as regular resolutions.

## v1.1.0

### Fixed

- Per-user `mergedPulls` counter now correctly counts merged pull requests (those with a
  non-null `merged_at`) instead of mirroring the `newPulls` count.
- Bot accounts (`adguard-bot`, `github-actions[bot]`) are now excluded from per-user
  counters at the stats-computation level, not only at Slack-publish time.
- Per-poll metadata is now appended (one record per run) instead of overwriting the file,
  enabling after-the-fact gap analysis.

### Added

- **Publish-time reconciliation**: `github-stats` and `github-publish` now cross-check
  closed issues and merged/opened PRs against the GitHub REST API for the reporting window
  and recover any events missed by the Events-API poller before computing stats.
- **Poll-time gap detection**: `github-poll` detects when the last successful poll was
  more than 90 minutes ago or when the Events-API window has rolled past events, flags the
  record with `gapSuspected: true`, and automatically backfills the gap window from REST.
- New metadata fields `oldestEventAt`, `newestEventAt`, and `gapSuspected` on every poll
  record.

## v1.0.1

### Added

- Error handling of GitHub API rate limit
  and metadata collection (which may be useful for failed runs analysis)
  for GitHub events polling.

## v1.0.0

### Added

- Initial release
