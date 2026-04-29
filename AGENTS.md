# AGENTS.md

Working reference for AI coding agents contributing to this repository.
For environment setup (Node.js, package manager, editor configuration), see
[README.md](./README.md).

## Table of Contents

- [Project Overview](#project-overview)
- [Technical Context](#technical-context)
- [Project Structure](#project-structure)
- [Build And Test Commands](#build-and-test-commands)
- [Contribution Instructions](#contribution-instructions)
- [Code Guidelines](#code-guidelines)
    - [System Design](#system-design)
    - [Architecture](#architecture)
    - [Code Quality](#code-quality)
    - [Testing](#testing)
    - [Dependency Management](#dependency-management)
    - [Configuration & Documentation](#configuration--documentation)
    - [Markdown Formatting](#markdown-formatting)
    - [Other](#other)

## Project Overview

`@adguard/github-stats` is a CLI toolkit that polls activity events from the
GitHub REST API for a given repository, stores them as daily JSONL files with
sidecar metadata, aggregates per-contributor statistics for an arbitrary time
window, and either prints them to the console or publishes them to a Slack
channel as formatted Block Kit messages.

The package ships three executables:

- `github-poll` — collect today's events from the GitHub Events API and
  append them (deduplicated) to the local JSONL collection.
- `github-stats` — compute and print contributor and repository statistics
  for a given time period.
- `github-publish` — compute statistics for a time period and publish them
  to a Slack channel.

It is intended to be invoked from CI (e.g. GitHub Actions — see
[examples/](./examples/)) on a regular schedule.

## Technical Context

- **Language/Version**: JavaScript (ES Modules in `src/`, transpiled by Babel,
  bundled to CommonJS in `bin/`). Targets modern Node.js (Node 22.17.0+,
  enforced via the `engines` field in `package.json`).
- **Primary Dependencies**: `@octokit/core` (GitHub REST), `@slack/web-api`
  (Slack publishing), `date-fns` (date math),
  `lodash` (utilities), `stream-json` / `stream-chain` (streaming JSONL
  parsing), `dotenv` (env loading).
- **Storage**: Local filesystem. Events are written as one JSONL file per day
  (`YYYY-MM-DD.jsonl`) plus a `YYYY-MM-DD-metadata.json` sidecar under the
  directory pointed to by `COLLECTION_PATH` (e.g. [stats-data/](./stats-data/)).
- **Testing**: Jest (with `babel-jest`). Tests live under [tests/](./tests/)
  mirroring the `src/` structure and use fixtures from
  [tests/test-files/](./tests/test-files/).
- **Target Platform**: Node.js CLI, run locally or from CI runners
  (GitHub Actions). No browser support.
- **Project Type**: Single-package CLI tool (multi-binary).
- **Performance Goals**: N/A. Runs are short-lived (seconds to a couple of
  minutes), bounded by the GitHub Events API which returns at most
  `MAX_NUMBER_OF_MOST_RECENT_EVENTS` (300) events per repo.
- **Constraints**:
    - GitHub Events API only exposes the 300 most recent events per repo, so
      `github-poll` must be scheduled frequently enough to avoid gaps.
    - Unauthenticated requests are limited to 60/hour; provide
      `GITHUB_TOKEN` in production.
    - Daily JSONL files older than `EVENT_EXPIRATION_DAYS` (30) are pruned
      during stat preparation.
- **Scale/Scope**: Single repository per invocation, single Slack channel
  per publish run. Designed for the AdGuard filter repositories
  (see `TEAM_MEMBERS` in [src/constants.js](./src/constants.js)) but
  configurable via env vars.

## Project Structure

```text
.
├── bin/                          # Rollup build output (CJS, with shebang)
│   ├── github-poll.js            # Entry: poll GitHub events
│   ├── github-publish.js         # Entry: publish stats to Slack
│   └── github-stats.js           # Entry: print stats to console
├── .github/
│   └── workflows/                # Production GitHub Actions (poll, stats, publish)
├── examples/                     # Sample GitHub Actions workflows for downstream users
├── scripts/                      # (reserved; currently empty)
├── src/
│   ├── github-poll.js            # CLI entry: read env, call pollEvents
│   ├── github-publish.js         # CLI entry: prepareStats + publishStats
│   ├── github-stats.js           # CLI entry: prepareStats + printStats
│   ├── constants.js              # Shared constants (team, thresholds, ...)
│   ├── poll-events/              # GitHub polling + JSONL append
│   ├── prepare-stats/            # Aggregation: contributors, repo, activity
│   ├── print-stats/              # Console formatting
│   ├── publish-stats/            # Slack publishing orchestration
│   ├── publish-utils/            # Slack client + Block Kit formatters
│   │   └── format-utils/         # Block Kit builders, pruning
│   └── tools/                    # Shared helpers (fs, gh, streams, print)
├── tests/                        # Jest tests mirroring src/ layout
│   ├── publish-utils/            # Tests for Slack block formatters
│   └── test-files/               # Fixtures
├── stats-data/                   # Default COLLECTION_PATH (JSONL + metadata)
├── babel.config.js               # Babel preset-env config
├── rollup.config.js              # Bundle src/*.js → bin/ as CJS w/ shebang
├── .eslintrc                     # ESLint (airbnb-base + project overrides)
├── .eslintignore
├── .env-example                  # Template for local .env
├── package.json
├── README.md                     # User-facing usage and install docs
└── AGENTS.md                     # This file
```

## Build And Test Commands

This project uses **Yarn** as its package manager (`yarn.lock` is the
committed lockfile and all GitHub Actions workflows under
[.github/workflows/](./.github/workflows/) invoke `yarn`). Use `yarn` for
day-to-day work; `npm run <script>` also works because the scripts are
plain wrappers, but match the existing tooling unless you have a reason
not to.

| Command            | Purpose                             |
| ------------------ | ----------------------------------- |
| `yarn install`     | Install dependencies                |
| `yarn build`       | Build CLI bundles (`src/` → `bin/`) |
| `yarn test`        | Run unit tests                      |
| `yarn lint`        | Lint the entire repo                |
| `yarn lint --fix`  | Auto-fix lint issues                |
| `yarn lint-staged` | Run lint-staged (used by Husky)     |
| `yarn poll`        | Poll events (locally)               |
| `yarn stats`       | Print stats (locally)               |
| `yarn publish`     | Publish to Slack (locally)          |

There is no separate formatter or type checker — ESLint (`airbnb-base`) is
the only static-analysis gate, and `yarn build` (Rollup + Babel) is the
closest thing to a type/parse check.

## Contribution Instructions

- You MUST verify your changes with the linter and the build.

    Use the following commands:
    - `yarn lint` to run ESLint over `src/`, `tests/`, and config files
    - `yarn lint --fix` to auto-fix lint issues where possible
    - `yarn build` to ensure the Rollup bundle still produces valid
      CommonJS output in `bin/`

- You MUST update the unit tests under [tests/](./tests/) for any changed
  code paths, and add new tests for new behavior.

- You MUST run `yarn test` and confirm all Jest suites pass before
  considering a task done.

- You MUST keep the `bin/` directory in sync with `src/` by running
  `yarn build` whenever you change source files that are bundled into a
  CLI entry. Commit the regenerated `bin/` artifacts together with the
  source change (the repository ships them as runnable binaries).

- When making changes to the project structure (adding/removing
  directories, moving modules, renaming entry points), ensure the Project
  Structure section in this `AGENTS.md` is updated and remains valid.

- If a prompt essentially asks you to refactor or improve existing code,
  check whether the underlying rule can be phrased as a code guideline.
  If it can, add it to the relevant Code Guidelines subsection in this
  `AGENTS.md`.

- After completing the task you MUST verify that the code you've written
  follows the [Code Guidelines](#code-guidelines) in this file.

## Code Guidelines

### System Design

Design for a command-line tool:

- The tool runs and exits — no long-lived daemons. Each CLI entry
  (`github-poll`, `github-stats`, `github-publish`) performs the requested
  work and exits with code 0 on success, non-zero on failure.
- Prefer stdout for primary output (stats, results) and stderr for
  diagnostics and errors. Keep the channels separate so that output can be
  piped or captured by CI.
- Fail fast with clear messages — validate required env vars
  (`COLLECTION_PATH`, `REPO`, plus `SLACK_*` for publish) at the very top
  of each entry script, log a human-readable error to stderr, and exit
  with a non-zero status.
- Configuration is via environment variables (loaded via `dotenv`).
  Document every supported variable in [README.md](./README.md) and in
  [.env-example](./.env-example).
- Keep startup time short — avoid heavy top-level work in modules that
  may be imported but not used by every entry point.
- Treat the local filesystem as the only persistent state. Writes to
  `COLLECTION_PATH` MUST be idempotent: re-running `github-poll` on the
  same day MUST deduplicate events, not duplicate them.

### Architecture

Universal principles the codebase follows:

- **Separation of Concerns** — polling, aggregation, console output, and
  Slack publishing each live in their own module directory under `src/`.
- **Single Responsibility Principle** — each file does one thing
  (e.g. `prepare-contributors.js`, `format-repo-stat.js`,
  `publish-message.js`). Less critical for tiny helper modules under
  `src/tools/`, but still followed.
- **Dependency Direction** — CLI entry scripts depend on feature modules,
  feature modules depend on `tools/` and `publish-utils/`; never the
  reverse. Constants flow from `src/constants.js` to everyone.
- **Explicit Boundaries** — every feature module exposes its public API
  through an `index.js` barrel. Importers MUST go through `index.js`
  rather than reaching into internal files.
- **Data Flow Clarity** — events flow `GitHub API → JSONL files →
  prepare-stats → {print-stats, publish-stats}`. There are no back
  edges.
- **Minimize Coupling, Maximize Cohesion** — Slack-specific logic lives
  entirely under `publish-utils/`; aggregation under `prepare-stats/`
  knows nothing about Slack or the console.
- **Make Invalid States Impossible** — less applicable in untyped
  JavaScript, but enforced through small, focused functions and
  constants in `src/constants.js` (event types, action names, label
  names) instead of magic strings.
- **Observability Built-in** — `github-poll` logs structured progress and
  rate-limit warnings to stdout/stderr. New long-running steps SHOULD
  log similarly via `console.log` / `console.warn`.
- **Keep It Boring** — prefer well-understood Node patterns
  (`async/await`, plain objects) over clever or novel
  solutions.

This project follows a layered architecture. From top (entry) to bottom
(infrastructure):

```text
CLI entries (src/github-{poll,stats,publish}.js, bin/*)
        ↓
Feature modules (src/poll-events, src/prepare-stats,
                 src/print-stats, src/publish-stats)
        ↓
Domain utilities (src/publish-utils, src/publish-utils/format-utils)
        ↓
Shared tools & constants (src/tools, src/constants.js)
        ↓
External services (GitHub REST API, Slack Web API, local filesystem)
```

A higher layer may call any layer below it. No layer may depend on a layer
above it. Sibling feature modules MUST NOT import from each other; if they
need shared logic, lift it into `src/tools/` or `src/publish-utils/`.

### Code Quality

- **Module system**: Source under `src/` and `tests/` is authored as ES
  Modules (`import` / `export`). Babel + Rollup transpile to CommonJS for
  the `bin/` output.
- **Linter**: ESLint with `eslint-config-airbnb-base`. Project-specific
  overrides live in [.eslintrc](./.eslintrc). Do NOT relax the airbnb rules
  globally; if a rule is genuinely wrong for a single line, use a scoped
  `// eslint-disable-next-line <rule>` with a reason rather than editing
  `.eslintrc`.
- **No formatter / no type checker**: There is no Prettier, no TypeScript.
  Match the surrounding style; let ESLint catch deviations.
- **Error handling**: Top-level CLI entry scripts SHOULD wrap their main
  IIFE in `try/catch`, log via `console.error`, and `process.exit(1)` on
  failure. Library functions SHOULD throw normal `Error` instances; let
  the caller decide how to recover.
- **Logging**: Use `console.log` for progress, `console.warn` for
  recoverable issues (rate-limit warnings, missing optional data), and
  `console.error` for fatal errors. Disable the `no-console` ESLint rule
  inline (`// eslint-disable-next-line no-console`) at each call site, as
  done elsewhere in the codebase.
- **Naming**: Files and directories use `kebab-case`
  (`prepare-contributors-stat.js`). Exported identifiers use
  `camelCase` for functions/values and `PascalCase` for classes (e.g.
  `Contributor`). Constants are `UPPER_SNAKE_CASE` and live in
  [src/constants.js](./src/constants.js).
- **Imports**: Each feature module exposes its public surface through
  `index.js`. Importers from outside the module MUST import from the
  module's directory (e.g. `from './prepare-stats'`), not from internal
  files.
- **JSDoc**: Document non-trivial functions and exported constants with
  JSDoc, following the style already present in [src/constants.js](./src/constants.js).

### Testing

- **Framework**: Jest with `babel-jest`. Configuration is implicit
  (defaults from `jest`). Tests are discovered under [tests/](./tests/).
- **Layout**: Tests mirror the `src/` directory layout under `tests/`
  (e.g. `src/publish-utils/format-utils/format-repo-stat.js` →
  `tests/publish-utils/repo-stat-to-blocks.test.js`).
- **Naming**: Test files end in `.test.js`.
- **Fixtures**: Static input/output fixtures live under
  [tests/test-files/](./tests/test-files/). Reuse existing fixtures when
  possible; add new ones rather than mutating shared ones.
- **What to test**: Focus on pure functions in `prepare-stats/` and
  `publish-utils/format-utils/` — they have well-defined inputs/outputs
  and no I/O. Network and filesystem boundaries (`@octokit/core`,
  `@slack/web-api`) SHOULD be mocked with `jest.mock` rather
  than hit live.
- **Coverage**: No formal threshold is enforced. New behavior MUST come
  with at least one test that exercises the success path and one for any
  meaningful failure path.
- **Verification**: `yarn test` MUST pass with no failing or pending
  suites before a change is considered done.

### Dependency Management

- **Pin all dependency versions explicitly** — replace caret/tilde ranges
  with exact versions in `package.json` for any new or updated
  dependency. Do not allow npm to silently move to an untested release.
- **Prefer vanilla solutions** — Node's standard library
  (`node:fs/promises`, `node:path`, `node:stream`, global `fetch` on
  Node 18+) usually suffices. Only add a dependency when it provides
  meaningful value over a hand-rolled solution.
- **Reputable sources only** — new dependencies MUST come from
  well-established, actively maintained projects (high weekly downloads,
  recent commits, recognized maintainers).
- **Avoid unpopular libraries** — do NOT add niche or obscure packages.
  They are a supply-chain risk and tend to become unmaintained.
- **Minimize dependency count** — every new dependency increases attack
  surface and bundle size. Justify each addition in the PR description.
- **Use the latest stable version** — when adding a dependency, check the
  npm registry for the latest stable release rather than copying a
  version number from another project or from memory.

**Rationale**: Fewer, well-vetted dependencies reduce security
vulnerabilities, supply-chain risks, and long-term maintenance cost.

**Known exclusions** (to be fixed):

- `lodash` is largely replaceable with built-in language features for the
  small set of helpers actually used; consider migrating.

### Configuration & Documentation

- **Runtime configuration**: All configuration is provided via
  environment variables, loaded by `dotenv` at the top of each CLI entry
  in [src/](./src/). The supported variables are:
  `COLLECTION_PATH`, `GITHUB_TOKEN`, `REPO`, `SINCE`, `UNTIL`,
  `SLACK_OAUTH_TOKEN`, `SLACK_CHANNEL_ID`. See
  [README.md#configuration](./README.md#configuration) for semantics.
- **Local overrides**: A `.env` file in the repo root is loaded at
  startup. `.env` is gitignored; commit changes to
  [.env-example](./.env-example) instead so contributors can copy it.
- **No secrets in code**: Tokens (`GITHUB_TOKEN`, `SLACK_OAUTH_TOKEN`)
  MUST come from the environment. Never hardcode them, log them, or
  commit them. Constants that are public (team handles, thresholds,
  excluded usernames) belong in [src/constants.js](./src/constants.js).
- **Documentation to keep in sync**:
    - [README.md](./README.md) — when CLI behavior, env vars, or install
      instructions change.
    - [.env-example](./.env-example) — when a new env var is introduced or
      a name changes.
    - [examples/](./examples/) — when the GitHub Actions integration
      surface changes.
    - This `AGENTS.md` — when project structure, build/test commands,
      conventions, or architecture change.
    - [CHANGELOG.md](./CHANGELOG.md) — for any user-visible change.

### Markdown Formatting

All Markdown files MUST follow these formatting rules:

- **Line length**: Keep lines at most 80 characters. This is not a hard
  lint gate, but SHOULD be followed for readability. Lines inside fenced
  code blocks are exempt from this limit.
- **Unordered lists**: Use dashes (`-`) for bullet points. Indent nested
  list items by 4 spaces.
- **Emphasis**: Use asterisks (`*`) for emphasis (`*italic*`,
  `**bold**`). Do NOT use underscores.
- **Headings**: Duplicate heading names are allowed only among sibling
  headings (same parent level). Avoid duplicates across different
  levels.
- **Inline HTML**: Avoid raw HTML in Markdown. The only allowed elements
  are `<a>`, `<p>`, `<details>`, `<summary>`, and `<img>`.
- **Trailing spaces**: Do NOT leave trailing whitespace on any line. Do
  NOT use two-space line breaks — use a blank line instead.
- **Bare URLs**: Bare URLs are permitted and do not need to be wrapped
  in angle brackets.
- **Table formatting**: Align table columns with padding when the table
  fits within 80 characters. If the table exceeds 80 characters or
  triggers an MD060 linter warning, switch to a compact format using
  single spaces only. This applies to the separator row as well — it
  should be written as `| --- |`, not `|--|`.

    Example of correct layout:

    ```markdown
    | Col1   | Col2   |
    | ------ | ------ |
    | Value1 | Value2 |
    ```

    Do NOT use extra padding or alignment characters beyond single
    spaces.

**Rationale**: Uniform Markdown formatting improves readability for both
humans and AI agents that consume project documentation.

### Other

- **Bundled CLI artifacts**: The contents of [bin/](./bin/) are generated by
  Rollup. Do NOT hand-edit them. The hashed sibling files
  (`fs-utils-*.js`, `prepare-stats-*.js`) are Rollup chunk artifacts;
  removing or renaming them by hand will break the published binaries —
  re-run `yarn build` to regenerate them cleanly.
- **Daily JSONL files**: `stats-data/*.jsonl` and the matching
  `*-metadata.json` sidecars are runtime data, not code. Treat them as
  fixtures only; do not refactor through them.
- **Husky / lint-staged**: A pre-commit hook (configured under
  [.husky/](./.husky/)) runs `lint-staged`, which lints staged
  `{src,tests,scripts}/**/*.js` files. Do not bypass it with
  `--no-verify` unless you have a specific reason and note it in the PR.
