jest.mock('../../src/publish-utils/make-client', () => ({
    makeClient: jest.fn(),
}));

// eslint-disable-next-line import/first
import { publishStats } from '../../src/publish-stats';
// eslint-disable-next-line import/first
import { makeClient } from '../../src/publish-utils/make-client';

// The formatters run with real code; a minimal valid statistic keeps them
// working without a fixture.
const statistics = {
    repoStat: {
        timePeriod: { since: '2026-11-01T00:00:00Z' },
        newIssues: 0,
        resolvedIssues: 0,
        closedAsStaleIssues: 0,
        newPulls: 0,
        mergedPulls: 0,
        remainingIssues: 0,
    },
    activityStat: {},
    activitiesByUser: {},
};

describe('publishStats — Slack failures', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('propagates a failed post', async () => {
        const postMessage = jest.fn().mockRejectedValue(new Error('post failed'));
        makeClient.mockReturnValue({ chat: { postMessage } });

        await expect(publishStats('token', 'channel', statistics)).rejects.toThrow('post failed');
        // The reply must not be attempted after the post failed.
        expect(postMessage).toHaveBeenCalledTimes(1);
    });

    it('propagates a failed reply', async () => {
        const postMessage = jest.fn()
            .mockResolvedValueOnce({ ts: '111.222' })
            .mockRejectedValueOnce(new Error('reply failed'));
        makeClient.mockReturnValue({ chat: { postMessage } });

        await expect(publishStats('token', 'channel', statistics)).rejects.toThrow('reply failed');
        // One post and one reply: the reply rejection reaches the caller.
        expect(postMessage).toHaveBeenCalledTimes(2);
        expect(postMessage).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ thread_ts: '111.222' }),
        );
    });
});
