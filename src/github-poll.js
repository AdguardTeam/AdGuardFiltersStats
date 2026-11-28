import 'dotenv/config';
import { format } from 'date-fns';
import { pollEvents } from './poll-events';
import { parseRepo, requireEnvVars } from './tools/env-utils';
import { describeError } from './tools/error-utils';
import { logger } from './tools/logger';

(async () => {
    try {
        const { COLLECTION_PATH, REPO } = requireEnvVars(['COLLECTION_PATH', 'REPO']);

        const commonRequestData = parseRepo(REPO);

        logger.log(`Starting GitHub events polling for ${REPO} at ${new Date().toISOString()}`);

        const result = await pollEvents(COLLECTION_PATH, commonRequestData);

        if (result.success) {
            const { metadata } = result;
            logger.log(`✅ Successfully fetched ${metadata.totalEvents} events for ${REPO}`);
            logger.log(
                `   ${metadata.eventsInFile} unique events in today's file after deduplication`,
            );

            if (metadata.totalEvents === 0) {
                logger.log('GitHub returned no events. This can be normal for a quiet repository.');
            }

            // Log the date for which we're collecting data
            const today = format(new Date(), 'yyyy-MM-dd');
            logger.log(`Data collected for ${today}`);
        } else {
            logger.error(`❌ Failed to collect GitHub events: ${result.error}`);

            // Exit with error code to notify CI/CD systems or cron job monitors
            process.exit(1);
        }
    } catch (error) {
        // One line and a non-zero exit: a stack trace hides the cause in the
        // CI log, and the exit code reports the failure to the workflow.
        logger.error(`❌ ${describeError(error, 'poll failed')}`);
        process.exit(1);
    }
})();
