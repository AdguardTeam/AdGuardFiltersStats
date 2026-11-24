import { format } from 'date-fns';
import { repoStatToString } from '../../src/tools/print-utils';

const formatTime = (iso) => format(new Date(iso), 'yyy-MM-dd HH-mm-ss');

describe('repoStatToString', () => {
    const repoStat = {
        timePeriod: { until: '2026-11-23T10:00:00Z' },
        newIssues: 1,
        resolvedIssues: 2,
        closedAsStaleIssues: 0,
        newPulls: 3,
        mergedPulls: 4,
        remainingIssues: 5,
    };

    it('names both bounds when the period has a lower bound', () => {
        const text = repoStatToString({
            ...repoStat,
            timePeriod: {
                since: '2026-11-22T10:00:00Z',
                until: '2026-11-23T10:00:00Z',
            },
        });

        expect(text).toContain(
            `from ${formatTime('2026-11-22T10:00:00Z')} to ${formatTime('2026-11-23T10:00:00Z')}`,
        );
    });

    it('names only the upper bound when SINCE is absent', () => {
        const text = repoStatToString(repoStat);

        expect(text).toContain(`Repo statistics for the period up to ${formatTime('2026-11-23T10:00:00Z')}.`);
    });
});
