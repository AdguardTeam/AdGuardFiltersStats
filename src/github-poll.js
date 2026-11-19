import * as dotenv from 'dotenv';
import { format } from 'date-fns';
import { pollEvents } from './poll-events';
import { MAX_NUMBER_OF_MOST_RECENT_EVENTS } from './constants';
import { requireEnvVars } from './tools/env-utils';
import { describeError } from './tools/error-utils';
import { logger } from './tools/logger';

dotenv.config();

(async () => {
    try {
        const { COLLECTION_PATH, REPO } = requireEnvVars(['COLLECTION_PATH', 'REPO']);

        const commonRequestData = {
            owner: REPO.split('/')[0],
            repo: REPO.split('/')[1],
        };

        logger.log(`Starting GitHub events polling for ${REPO} at ${new Date().toISOString()}`);

        const result = await pollEvents(COLLECTION_PATH, commonRequestData);

        if (result.success) {
            const { metadata } = result;
            logger.log(`✅ Successfully fetched ${metadata.totalEvents} events for ${REPO}`);
            logger.log(`   ${metadata.eventsInFile} unique events written after deduplication`);

            if (metadata.rateLimitReached) {
                logger.warn('⚠️ GitHub API rate limit was reached during collection');
                logger.warn(`Rate limit will reset at: ${metadata.rateLimitReset}`);
            }

            if (metadata.totalEvents >= MAX_NUMBER_OF_MOST_RECENT_EVENTS) {
                logger.warn(`⚠️ GitHub Events API limit of ${MAX_NUMBER_OF_MOST_RECENT_EVENTS} events was reached`);
                logger.warn('Some events may be missing. Consider polling more frequently.');
            }

            if (metadata.totalEvents === 0) {
                logger.log('GitHub returned no events. This can be normal for a quiet repository.');
            }

            // Log the date for which we're collecting data
            const today = format(new Date(), 'yyyy-MM-dd');
            logger.log(`Data collected for ${today}`);
        } else {
            logger.error('❌ Failed to collect GitHub events');
            logger.error(`Error: ${result.error || 'Unknown error'}`);

            if (result.metadata) {
                logger.error('Metadata:', JSON.stringify(result.metadata, null, 2));
            }

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
