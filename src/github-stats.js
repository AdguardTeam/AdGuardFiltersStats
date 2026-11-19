import * as dotenv from 'dotenv';
import { prepareStats } from './prepare-stats';
import { printStats } from './print-stats/print-stats';
import { requireEnvVars } from './tools/env-utils';
import { describeError } from './tools/error-utils';
import { logger } from './tools/logger';

dotenv.config();

(async () => {
    try {
        const { COLLECTION_PATH, REPO } = requireEnvVars(['COLLECTION_PATH', 'REPO']);
        const { SINCE, UNTIL } = process.env;

        const commonRequestData = {
            owner: REPO.split('/')[0],
            repo: REPO.split('/')[1],
        };

        const timePeriod = {
            until: UNTIL || new Date().toISOString(),
            since: SINCE,
        };

        const statistics = await prepareStats(COLLECTION_PATH, commonRequestData, timePeriod);

        printStats(statistics);
    } catch (error) {
        // One line and a non-zero exit: a stack trace hides the cause in the
        // CI log, and the exit code reports the failure to the workflow.
        logger.error(`❌ ${describeError(error, 'stats failed')}`);
        process.exit(1);
    }
})();
