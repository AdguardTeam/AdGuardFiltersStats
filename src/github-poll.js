import * as dotenv from 'dotenv';
import { format } from 'date-fns';
import { pollEvents } from './poll-events';
import { MAX_NUMBER_OF_MOST_RECENT_EVENTS } from './constants';

dotenv.config();
const { COLLECTION_PATH, REPO } = process.env;

if (!COLLECTION_PATH || !REPO) {
    // eslint-disable-next-line no-console
    console.error('Error: COLLECTION_PATH and REPO environment variables must be set');
    process.exit(1);
}

const commonRequestData = {
    owner: REPO.split('/')[0],
    repo: REPO.split('/')[1],
};

(async () => {
    try {
        // eslint-disable-next-line no-console
        console.log(`Starting GitHub events polling for ${REPO} at ${new Date().toISOString()}`);

        const result = await pollEvents(COLLECTION_PATH, commonRequestData);

        if (result.success) {
            const { metadata } = result;
            // eslint-disable-next-line no-console
            console.log(`✅ Successfully collected ${metadata.totalEvents} events for ${REPO}`);

            if (metadata.rateLimitReached) {
                // eslint-disable-next-line no-console
                console.warn('⚠️ GitHub API rate limit was reached during collection');
                // eslint-disable-next-line no-console
                console.warn(`Rate limit will reset at: ${metadata.rateLimitReset}`);
            }

            if (metadata.totalEvents >= MAX_NUMBER_OF_MOST_RECENT_EVENTS) {
                // eslint-disable-next-line no-console
                console.warn(`⚠️ GitHub Events API limit of ${MAX_NUMBER_OF_MOST_RECENT_EVENTS} events was reached`);
                // eslint-disable-next-line no-console
                console.warn('Some events may be missing. Consider polling more frequently.');
            }

            if (metadata.totalEvents === 0) {
                // eslint-disable-next-line no-console
                console.warn('⚠️ No events were collected for today. This might indicate an issue.');
            }

            // Log the date for which we're collecting data
            const today = format(new Date(), 'yyyy-MM-dd');
            // eslint-disable-next-line no-console
            console.log(`Data collected for ${today}`);
        } else {
            // eslint-disable-next-line no-console
            console.error('❌ Failed to collect GitHub events');
            // eslint-disable-next-line no-console
            console.error(`Error: ${result.error || 'Unknown error'}`);

            if (result.metadata) {
                // eslint-disable-next-line no-console
                console.error('Metadata:', JSON.stringify(result.metadata, null, 2));
            }

            // Exit with error code to notify CI/CD systems or cron job monitors
            process.exit(1);
        }
    } catch (error) {
        // eslint-disable-next-line no-console
        console.error('❌ Unhandled error in GitHub polling script:', error.message);
        process.exit(1);
    }
})();
