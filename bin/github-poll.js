#!/usr/bin/env node
import * as dotenv from 'dotenv';
import { pollEvents } from '../src/poll-events';

dotenv.config();
const { COLLECTION_PATH, REPO } = process.env;

const commonRequestData = {
    owner: REPO.split('/')[0],
    repo: REPO.split('/')[1],
};

(async () => {
    await pollEvents(COLLECTION_PATH, commonRequestData);
})();
