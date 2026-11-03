import { EVENT_TYPES } from '../constants';

/**
 * Convert a REST commit object into a synthetic PushEvent that carries exactly one commit.
 *
 * The GitHub Events API no longer includes the commits list in PushEvent payloads,
 * so the REST commits endpoint is the only reliable source of per-commit data.
 * Each commit becomes its own event to keep the existing attribution and
 * counting logic unchanged: the event actor is the commit author, and
 * `getCommitsCount()` reads the `payload.commits` array.
 *
 * @param {object} commit Commit object returned by the GitHub REST API.
 * @param {object} repo Repository metadata object with `id` and `name` fields.
 *
 * @returns {object|null} Synthetic PushEvent, or null if the commit has no linked
 * GitHub author or no committer date.
 */
const commitToPushEvent = (commit, repo) => {
    const { author } = commit;
    if (!author || !author.login) {
        return null;
    }
    const committerDate = commit.commit?.committer?.date;
    if (!committerDate) {
        return null;
    }
    return {
        id: `synthetic-commit-${commit.sha}`,
        type: EVENT_TYPES.PUSH_EVENT,
        actor: { id: author.id, login: author.login },
        repo,
        payload: {
            push_id: null,
            head: commit.sha,
            before: commit.parents?.[0]?.sha ?? null,
            ref: null,
            commits: [{
                sha: commit.sha,
                message: commit.commit?.message ?? '',
                author: commit.commit?.author ?? null,
                distinct: true,
            }],
        },
        created_at: committerDate,
    };
};

/**
 * Build one synthetic PushEvent per commit.
 *
 * Commits without a linked GitHub author cannot be attributed to a contributor
 * and are skipped. The raw Git author name is not used instead, because it would
 * create a second contributor key next to the GitHub login.
 *
 * @param {Array<object>} commits Commits returned by `getCommitsInWindow()`.
 * @param {object} repo Repository metadata object with `id` and `name` fields.
 *
 * @returns {Array<object>} Synthetic PushEvents, one per attributable commit.
 */
export const buildCommitEvents = (commits, repo) => {
    const events = [];
    for (const commit of commits) {
        const event = commitToPushEvent(commit, repo);
        if (event) {
            events.push(event);
        }
    }
    return events;
};
