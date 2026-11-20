import * as dotenv from 'dotenv';
import { startOfYesterday, endOfYesterday } from 'date-fns';
import { prepareStats } from './prepare-stats';
import { publishStats } from './publish-stats';
import { requireEnvVars } from './tools/env-utils';
import { describeError } from './tools/error-utils';
import { logger } from './tools/logger';

dotenv.config();

(async () => {
    try {
        const {
            COLLECTION_PATH,
            REPO,
            SLACK_OAUTH_TOKEN,
            SLACK_CHANNEL_ID,
        } = requireEnvVars([
            'COLLECTION_PATH',
            'REPO',
            'SLACK_OAUTH_TOKEN',
            'SLACK_CHANNEL_ID',
        ]);
        const { SINCE, UNTIL } = process.env;

        const commonRequestData = {
            owner: REPO.split('/')[0],
            repo: REPO.split('/')[1],
        };

        // Set defaults to last 24h period
        const timePeriod = {
            since: SINCE || startOfYesterday().toISOString(),
            until: UNTIL || endOfYesterday().toISOString(),
        };

        const statistics = await prepareStats(COLLECTION_PATH, commonRequestData, timePeriod);
        await publishStats(SLACK_OAUTH_TOKEN, SLACK_CHANNEL_ID, statistics);
    } catch (error) {
        // One line and a non-zero exit: a stack trace hides the cause in the
        // CI log, and the exit code reports the failure to the workflow.
        logger.error(`❌ ${describeError(error, 'publish failed')}`);
        process.exit(1);
    }
})();
