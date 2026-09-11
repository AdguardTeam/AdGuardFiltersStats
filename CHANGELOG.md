# GitHub Stats CLI App Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog], and this project adheres to [Semantic Versioning].

[Keep a Changelog]: https://keepachangelog.com/en/1.0.0/
[Semantic Versioning]: https://semver.org/spec/v2.0.0.html

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
