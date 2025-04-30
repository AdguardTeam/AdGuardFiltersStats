#!/usr/bin/env node
import * as dotenv from 'dotenv';
import { startOfYesterday, endOfYesterday } from 'date-fns';
import { prepareStats } from '../src/prepare-stats/prepare-stats.js';
import { publishStats } from '../src/publish-stats.js';

dotenv.config();

const {
    SLACK_OAUTH_TOKEN,
    SLACK_CHANNEL_ID,
    COLLECTION_PATH,
    REPO,
    SINCE,
    UNTIL,
} = process.env;

const commonRequestData = {
    owner: REPO.split('/')[0],
    repo: REPO.split('/')[1],
};

// Set defaults to last 24h period
const timePeriod = {
    since: SINCE || startOfYesterday().toISOString(),
    until: UNTIL || endOfYesterday().toISOString(),
};

(async () => {
    const statistics = await prepareStats(COLLECTION_PATH, commonRequestData, timePeriod);
    await publishStats(SLACK_OAUTH_TOKEN, SLACK_CHANNEL_ID, statistics);
})();
