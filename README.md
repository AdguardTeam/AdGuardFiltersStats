# GitHub Stats CLI App

CLI App that polls data from GitHub REST API, stores it and gives analysis on contributors activity for given repository.

* [Activity count](#activity_count)
* [How to install](#how-to-install)
* [How to run](#how-to-run)
    * [Poll events](#poll-events)
    * [Print stats in console](#print-stats)
    * [Publish stats to a slack channel](#publish-stats)
    * [Params](#params)

## <a id="activity_count"></a> Activity count

Here's what counts as activity:

* commit,
* closed Issue (not marked as Stale),
* a comment in an Issue or a Pull request,
* review of a Pull request (regardless of whether it's approved or rejected),
* merge of a Pull request.

Examples of Github Actions for these scripts can be found in `examples` folder.

## <a id="how-to-install"></a> How to install

```bash
npm i -g @adguard/github-stats
```

## <a id="how-to-run"></a> How to run

### <a id="poll-events"></a> Poll events

Polls events from GitHub API and stores them in JSONL files (one per day) along with metadata files.

```bash
env \
    COLLECTION_PATH=stats-data \
    GITHUB_TOKEN=token \
    REPO=AdguardTeam/AdguardFilters \
    github-poll
```

#### Metadata fields

* `totalEvents` — total number of events fetched from GitHub API
* `eventsWritten` — number of unique events written to file after deduplication
* `pagesCollected` — number of API pages processed
* `rateLimitReached` — whether API rate limit was reached
* `rateLimitRemaining` — remaining API requests
* `rateLimitReset` — when the rate limit will reset

> Note: `eventsWritten` may be less than `totalEvents` due to deduplication of events that appear in multiple poll runs.

### <a id="print-stats"></a> Print stats in console

```bash
env \
    COLLECTION_PATH=stats-data \
    GITHUB_TOKEN=token \
    REPO=AdguardTeam/AdguardFilters \
    UNTIL=2022-05-25T15:00:00Z \
    SINCE=2022-05-01T00:00:00Z \
    github-stats
```

### <a id="publish-stats"></a> Publish stats to a slack channel

```bash
env \
    SLACK_OAUTH_TOKEN=token \
    SLACK_CHANNEL_ID=id \
    COLLECTION_PATH=stats-data \
    REPO=AdguardTeam/AdguardFilters \
    UNTIL=2022-11-22T21:00:00Z \
    SINCE=2022-11-21T21:00:00Z \
    github-publish
```

### <a id="params"></a> Params

* `COLLECTION_PATH` — required, path to a jsonl file that stores events
* `GITHUB_TOKEN` — optional, Github Personal Access Token. API rate is limited to 60 requests an hour if not provided.
* `REPO` — required, path to a Github repository as `{owner}/{repo_name}`
* `UNTIL` — optional, timestamp in ISO 8601 format: `YYYY-MM-DDTHH:MM:SS`. Defaults to now.
* `SINCE` — optional, timestamp in ISO 8601 format: `YYYY-MM-DDTHH:MM:SS`. All stored events will be used if not provided.

#### Additional params for publishing

* `SLACK_OAUTH_TOKEN` — required, Slack App token
* `SLACK_CHANNEL_ID` — required, channel id to post messages to
