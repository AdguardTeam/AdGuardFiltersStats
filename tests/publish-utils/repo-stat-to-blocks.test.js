import { format } from 'date-fns';
import {
    formatRepoStat,
    getTextBlock,
} from '../../src/publish-utils/format-utils';

describe('Formatting general repo stat the right way', () => {
    it('works', () => {
        const repoStat = {
            timePeriod: {
                since: '2022-11-25T11:59:51.411Z',
                until: '2022-11-26T11:59:51.411Z',
            },
            newIssues: 13,
            resolvedIssues: 5,
            closedAsStaleIssues: 3,
            newPulls: 0,
            mergedPulls: 3,
            remainingIssues: 1293,
        };

        const {
            timePeriod,
            newIssues,
            resolvedIssues,
            closedAsStaleIssues,
            newPulls,
            mergedPulls,
            remainingIssues,
        } = repoStat;

        const expected = [
            getTextBlock(`*${format(new Date(timePeriod.since), 'EEEE, dd.MM.y')}*`),
            {
                type: 'header',
                text: {
                    type: 'plain_text',
                    text: '⚡ General repo statistics',
                },
            },
            getTextBlock(`*Resolved issues:* ${resolvedIssues}`),
            getTextBlock(`*New issues:* ${newIssues}`),
            getTextBlock(`*Closed as stale:* ${closedAsStaleIssues}`),
            getTextBlock(`*New pull requests:* ${newPulls}`),
            getTextBlock(`*Merged pull requests:* ${mergedPulls}`),
            getTextBlock(`*Remaining issues:* ${remainingIssues}`),
        ];

        const statBlocks = formatRepoStat(repoStat);

        expect(statBlocks).toStrictEqual(expected);
    });
});
