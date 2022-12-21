import { formatUserActivity, getUserIcon } from '../../src/publish-utils';

describe('Formatting personal activity stat the right way', () => {
    it('works', () => {
        const username = 'test-name';
        const resolvedIssues = 1;
        const newPulls = 2;
        const mergedPulls = 3;
        const pullRequestsReview = 4;
        const totalCommits = 5;
        const totalComments = 6;
        const activityObject = {
            [username]: {
                resolvedIssues,
                newPulls,
                mergedPulls,
                pullRequestsReview,
                totalCommits,
                totalComments,
            },
        };

        const expectedBlocks = [
            [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `${getUserIcon(username)}*<https://github.com/${username}|${username}>*`,
                    },
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `
Resolved issues: ${resolvedIssues}
Total commits: ${totalCommits}
Pull requests reviews: ${pullRequestsReview}`,
                    },
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `
Merged pull requests: ${mergedPulls}
New pull requests: ${newPulls}
Total comments: ${totalComments}`,
                    },
                },
            ],
        ];
        const result = formatUserActivity(activityObject);

        expect(expectedBlocks).toStrictEqual(result);
    });
});
