# Development Guide

This guide describes how to set up a local development environment for
`@adguard/github-stats`, run the CLI tools against real data, run tests
and linters, and contribute changes back.

For a high-level overview of what the tool does and how end users install
it, see [README.md](./README.md). For coding conventions, architecture
rules, and AI agent guidance, see [AGENTS.md](./AGENTS.md).

## Table of Contents

- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
    - [1. Clone the repository](#1-clone-the-repository)
    - [2. Install dependencies](#2-install-dependencies)
    - [3. Configure environment variables](#3-configure-environment-variables)
    - [4. Build the CLI bundles](#4-build-the-cli-bundles)
    - [5. Run a CLI locally](#5-run-a-cli-locally)
- [Development Workflow](#development-workflow)
    - [Branching and pull requests](#branching-and-pull-requests)
    - [Code style](#code-style)
    - [Testing](#testing)
    - [Building](#building)
    - [Pre-commit hooks](#pre-commit-hooks)
- [Common Tasks](#common-tasks)
    - [Polling events locally](#polling-events-locally)
    - [Printing stats locally](#printing-stats-locally)
    - [Publishing stats to Slack locally](#publishing-stats-to-slack-locally)
    - [Adding a new dependency](#adding-a-new-dependency)
    - [Adding a new environment variable](#adding-a-new-environment-variable)
    - [Adding a new test](#adding-a-new-test)
- [Debugging](#debugging)
    - [Debugging a CLI entry in VS Code](#debugging-a-cli-entry-in-vs-code)
    - [Debugging a Jest test in VS Code](#debugging-a-jest-test-in-vs-code)
- [Troubleshooting](#troubleshooting)
- [Additional Resources](#additional-resources)

## Prerequisites

Install the following tools before you start:

- **Node.js 18.x or newer** — required by the runtime; the codebase uses
  ES Modules in `src/` and Rollup-bundled CommonJS in `bin/`. Node 18+
  is the lowest version that ships built-in `fetch` and
  `AbortController`, which keeps the door open for replacing
  `node-fetch@2`.
- **Yarn 1.x (Classic)** — the committed lockfile is `yarn.lock` and
  every workflow under [.github/workflows/](./.github/workflows/) calls
  `yarn install` and `yarn build`. Yarn 2+ (Berry) is not supported.
- **Git** — any recent version.
- A **GitHub Personal Access Token** with `public_repo` scope for
  authenticated polling. Without a token the GitHub Events API is
  limited to 60 requests per hour.
- A **Slack bot token** (`xoxb-...`) and target channel id, only if you
  want to exercise `github-publish` locally.

Optional but recommended:

- An editor with ESLint integration (VS Code with the ESLint extension
  works out of the box; no Prettier or TypeScript is configured for
  this repo).

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/AdguardTeam/AdGuardFiltersStats.git
cd AdGuardFiltersStats
```

### 2. Install dependencies

```bash
yarn install
```

This installs both runtime and dev dependencies and sets up the Husky
pre-commit hook (see [Pre-commit hooks](#pre-commit-hooks)).

### 3. Configure environment variables

Copy [.env-example](./.env-example) to `.env` in the repository root and
fill in the values you need:

```bash
cp .env-example .env
```

`.env` is gitignored. The file is loaded by `dotenv` at the top of each
CLI entry script in [src/](./src/).

Supported variables:

| Variable            | Required for                  | Description                                                                  |
| ------------------- | ----------------------------- | ---------------------------------------------------------------------------- |
| `COLLECTION_PATH`   | `poll`, `stats`, `publish`    | Directory where daily JSONL event files and metadata sidecars are stored.    |
| `REPO`              | `poll`, `stats`, `publish`    | Target repository in `{owner}/{repo_name}` form.                             |
| `GITHUB_TOKEN`      | `poll` (recommended), `stats` | GitHub PAT. Without it, requests are limited to 60/hour.                     |
| `SINCE`             | `stats`, `publish`            | ISO 8601 timestamp (`YYYY-MM-DDTHH:MM:SSZ`). Lower bound of the stat window. |
| `UNTIL`             | `stats`, `publish`            | ISO 8601 timestamp. Upper bound of the stat window. Defaults to now.         |
| `SLACK_OAUTH_TOKEN` | `publish`                     | Slack bot token (`xoxb-...`).                                                |
| `SLACK_CHANNEL_ID`  | `publish`                     | Slack channel id to post to.                                                 |

When you add a new variable, also update [.env-example](./.env-example)
and the relevant section in [README.md](./README.md).

### 4. Build the CLI bundles

The `bin/` directory contains Rollup-generated CommonJS bundles with
shebangs. Source changes in `src/` are not picked up by `yarn poll`,
`yarn stats`, or `yarn publish` until you rebuild:

```bash
yarn build
```

Rollup writes:

- `bin/github-poll.js`
- `bin/github-stats.js`
- `bin/github-publish.js`
- hashed shared chunks (e.g. `bin/fs-utils-*.js`,
  `bin/prepare-stats-*.js`)

Do not hand-edit any file under `bin/` — re-run `yarn build` instead.
Commit the regenerated `bin/` artifacts together with the source change.

### 5. Run a CLI locally

After `yarn build`, invoke any of:

```bash
yarn poll       # node ./bin/github-poll.js
yarn stats      # node ./bin/github-stats.js
yarn publish    # node ./bin/github-publish.js
```

Each script reads its configuration from the environment (or `.env`) as
described above.

## Development Workflow

### Branching and pull requests

- Create a feature branch off the default branch.
- Keep changes focused; one logical change per PR.
- Match the existing commit message style (short imperative subject).
- Before opening a PR:
    - run `yarn lint`
    - run `yarn test`
    - run `yarn build` and commit the regenerated `bin/` artifacts if
      any source under `src/` changed
    - update [README.md](./README.md), [.env-example](./.env-example),
      [examples/](./examples/), [AGENTS.md](./AGENTS.md), and
      [CHANGELOG.md](./CHANGELOG.md) when relevant (see the
      "Configuration & Documentation" section in
      [AGENTS.md](./AGENTS.md)).

### Code style

- Source under [src/](./src/) and [tests/](./tests/) is authored as ES
  Modules. Babel + Rollup transpile to CommonJS for `bin/`.
- Linting is the only static-analysis gate: ESLint with
  `eslint-config-airbnb-base`, configured in [.eslintrc](./.eslintrc).
- There is no Prettier and no TypeScript. Match the surrounding style
  and let ESLint catch deviations.
- Full conventions (naming, imports, JSDoc, layered architecture, etc.)
  are documented in [AGENTS.md](./AGENTS.md#code-guidelines) — read it
  before contributing non-trivial changes.

Useful commands:

```bash
yarn lint           # lint the entire repo
yarn lint --fix     # auto-fix where possible
```

### Testing

The project uses Jest with `babel-jest`. Tests live under
[tests/](./tests/) and mirror the `src/` layout. Static fixtures live in
[tests/test-files/](./tests/test-files/) — reuse them where possible
and add new fixtures rather than mutating shared ones.

Run all tests:

```bash
yarn test
```

Run a single test file:

```bash
yarn test tests/publish-utils/repo-stat-to-blocks.test.js
```

Run tests matching a name pattern:

```bash
yarn test -t "repo stat"
```

Watch mode while developing:

```bash
yarn test --watch
```

Focus testing on pure functions in `src/prepare-stats/` and
`src/publish-utils/format-utils/`. Mock network and filesystem
boundaries (`@octokit/core`, `@slack/web-api`, `fs-extra`) with
`jest.mock` rather than hitting them live. New behavior MUST come with
at least one success-path test and one failure-path test.

### Building

```bash
yarn build
```

Configuration lives in [rollup.config.js](./rollup.config.js) and
[babel.config.js](./babel.config.js). The build doubles as a parse/type
sanity check; treat a failed build the same as a failed lint.

### Pre-commit hooks

Husky installs a pre-commit hook at [.husky/pre-commit](./.husky/pre-commit)
that runs:

```bash
yarn lint-staged
yarn test
```

`lint-staged` lints staged files matching `{src,tests,scripts}/**/*.js`.
Do not bypass the hook with `git commit --no-verify` unless you have a
specific reason and call it out in the PR description.

## Common Tasks

### Polling events locally

Authenticated polling against a public repository:

```bash
env \
    COLLECTION_PATH=stats-data \
    GITHUB_TOKEN=ghp_xxx \
    REPO=AdguardTeam/AdguardFilters \
    yarn poll
```

Re-running on the same day is safe — events are deduplicated and the
metadata sidecar (`stats-data/YYYY-MM-DD-metadata.json`) is updated in
place.

### Printing stats locally

```bash
env \
    COLLECTION_PATH=stats-data \
    REPO=AdguardTeam/AdguardFilters \
    SINCE=2025-05-01T00:00:00Z \
    UNTIL=2025-05-25T15:00:00Z \
    yarn stats
```

### Publishing stats to Slack locally

Use a private test channel and a dedicated bot token. Never publish to
production channels from a dev machine.

```bash
env \
    SLACK_OAUTH_TOKEN=xoxb-xxx \
    SLACK_CHANNEL_ID=Cxxxxxxxx \
    COLLECTION_PATH=stats-data \
    REPO=AdguardTeam/AdguardFilters \
    SINCE=2025-05-01T00:00:00Z \
    UNTIL=2025-05-02T00:00:00Z \
    yarn publish
```

### Adding a new dependency

Follow the rules in [AGENTS.md → Dependency Management](./AGENTS.md#dependency-management):

- Pin the exact version (no `^` or `~`) in `package.json`.
- Use the latest stable release from npm.
- Justify the addition; prefer Node built-ins or existing helpers.

```bash
yarn add <pkg>@<exact-version>
yarn add --dev <pkg>@<exact-version>
```

After adding, run `yarn build` and `yarn test` to confirm nothing
regressed.

### Adding a new environment variable

1. Read it from `process.env` at the top of the relevant CLI entry in
   [src/](./src/), validating it and exiting non-zero on missing
   required values.
2. Add it to [.env-example](./.env-example) with a placeholder value.
3. Document it in [README.md](./README.md#params) and in the table in
   [Step 3](#3-configure-environment-variables) of this guide.
4. Update [examples/](./examples/) workflows if the new variable is
   needed in CI.

### Adding a new test

1. Create a `*.test.js` file under [tests/](./tests/) that mirrors the
   path of the module under test.
2. Add fixtures to [tests/test-files/](./tests/test-files/) when
   helpful.
3. Mock external boundaries with `jest.mock`.
4. Run `yarn test` and confirm the suite passes.

## Debugging

### Debugging a CLI entry in VS Code

The CLI entries source-map back to `src/`. A minimal launch
configuration in `.vscode/launch.json`:

```json
{
    "version": "0.2.0",
    "configurations": [
        {
            "type": "node",
            "request": "launch",
            "name": "Debug github-poll",
            "program": "${workspaceFolder}/bin/github-poll.js",
            "envFile": "${workspaceFolder}/.env",
            "console": "integratedTerminal",
            "skipFiles": ["<node_internals>/**"]
        }
    ]
}
```

Run `yarn build` once before starting the debugger so `bin/` reflects
your latest changes.

### Debugging a Jest test in VS Code

```json
{
    "type": "node",
    "request": "launch",
    "name": "Debug Jest (current file)",
    "program": "${workspaceFolder}/node_modules/.bin/jest",
    "args": ["--runInBand", "${relativeFile}"],
    "console": "integratedTerminal",
    "internalConsoleOptions": "neverOpen"
}
```

You can also drop `debugger;` statements anywhere in `src/` or
`tests/` — Babel preserves them.

For ad-hoc logging, the project standard is plain `console.log` /
`console.warn` / `console.error` with an inline
`// eslint-disable-next-line no-console` comment at each call site, as
already used in the codebase.

## Troubleshooting

**`API rate limit exceeded` from `github-poll`**
You are running unauthenticated. Set `GITHUB_TOKEN` in `.env` (PAT with
`public_repo` scope is enough). The unauthenticated limit is 60
requests per hour; authenticated is 5000.

**Stats are missing recent events**
The GitHub Events API only returns the 300 most recent events per
repository, and daily JSONL files older than `EVENT_EXPIRATION_DAYS`
(30) are pruned during stat preparation. Run `github-poll` more
frequently from CI to avoid gaps.

**`yarn poll` / `yarn stats` / `yarn publish` does not reflect my
changes**
These scripts run the bundled files under `bin/`. Re-run `yarn build`
after any change to `src/`.

**Pre-commit hook does not run**
Re-install dependencies (`yarn install`) so Husky re-installs the git
hook. Verify `.husky/pre-commit` is executable
(`chmod +x .husky/pre-commit`).

**`yarn build` fails with a Rollup chunk error**
Stale or hand-edited files under `bin/` (especially the hashed
`fs-utils-*.js` / `prepare-stats-*.js` chunks) can confuse incremental
builds. Delete `bin/` and re-run `yarn build`.

**Slack publish fails with `not_in_channel`**
Invite the bot user (whose token is in `SLACK_OAUTH_TOKEN`) to the
target channel — `/invite @your-bot` from inside the channel.

**Slack publish fails with `invalid_blocks`**
Block Kit payloads above Slack's per-message limits are pruned by the
helpers under [src/publish-utils/format-utils/](./src/publish-utils/format-utils/).
If you changed a formatter, add a unit test under
[tests/publish-utils/](./tests/publish-utils/) reproducing the failing
input.

## Additional Resources

- [README.md](./README.md) — user-facing usage and install instructions
- [AGENTS.md](./AGENTS.md) — code guidelines, architecture, and
  contribution rules
- [CHANGELOG.md](./CHANGELOG.md) — user-visible changes
- [examples/](./examples/) — sample GitHub Actions workflows
- [.github/workflows/](./.github/workflows/) — production CI workflows
- [GitHub REST API — Events](https://docs.github.com/en/rest/activity/events)
- [Slack Web API — `chat.postMessage`](https://api.slack.com/methods/chat.postMessage)
- [Slack Block Kit Builder](https://app.slack.com/block-kit-builder)
