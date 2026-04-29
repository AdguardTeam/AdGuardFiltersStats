#!/usr/bin/env node
'use strict';

var dotenv = require('dotenv');
var dateFns = require('date-fns');
var path = require('path');
var fsUtils = require('./fs-utils-DxFsNDOK.js');
require('@octokit/core');
require('fs-extra');
require('stream');
require('stream-chain');
require('string_decoder');

function _interopNamespaceDefault(e) {
    var n = Object.create(null);
    if (e) {
        Object.keys(e).forEach(function (k) {
            if (k !== 'default') {
                var d = Object.getOwnPropertyDescriptor(e, k);
                Object.defineProperty(n, k, d.get ? d : {
                    enumerable: true,
                    get: function () { return e[k]; }
                });
            }
        });
    }
    n.default = e;
    return Object.freeze(n);
}

var dotenv__namespace = /*#__PURE__*/_interopNamespaceDefault(dotenv);

/**
 * Polls events from Github Events API and stores them on a given path
 *
 * @param {string} collectionPath path to events collection
 * @param {Object} commonRequestData
 * @returns {Promise<Object>} Collection metadata
 */
const pollEvents = async (collectionPath, commonRequestData) => {
  try {
    // Get events from GitHub API with enhanced error handling
    const {
      events,
      metadata
    } = await fsUtils.getGithubEvents(commonRequestData);
    if (events.length === 0) {
      // eslint-disable-next-line no-console
      console.error('No events were collected from GitHub API');
      return {
        success: false,
        metadata
      };
    }

    // Write events to collection
    await fsUtils.writePollToCollection(collectionPath, events);
    const actualEventsWritten = await fsUtils.removeDupesFromCollection(collectionPath);
    await fsUtils.removeOldFilesFromCollection(collectionPath, fsUtils.EVENT_EXPIRATION_DAYS);

    // Store metadata for diagnostics
    const today = dateFns.format(new Date(), 'yyyy-MM-dd');
    const metadataPath = path.join(collectionPath, `${today}-metadata.json`);
    await fsUtils.writeMetadataToFile(metadataPath, {
      ...metadata,
      eventsWritten: actualEventsWritten,
      collectionPath,
      repo: `${commonRequestData.owner}/${commonRequestData.repo}`
    });

    // Return success status and metadata
    return {
      success: true,
      metadata: {
        ...metadata,
        eventsWritten: actualEventsWritten
      }
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Error in pollEvents:', error.message);
    // Return failure status and error information
    return {
      success: false,
      error: error.message,
      metadata: {
        timestamp: new Date().toISOString(),
        error: error.message
      }
    };
  }
};

dotenv__namespace.config();
const {
  COLLECTION_PATH,
  REPO
} = process.env;
if (!COLLECTION_PATH || !REPO) {
  // eslint-disable-next-line no-console
  console.error('Error: COLLECTION_PATH and REPO environment variables must be set');
  process.exit(1);
}
const commonRequestData = {
  owner: REPO.split('/')[0],
  repo: REPO.split('/')[1]
};
(async () => {
  try {
    // eslint-disable-next-line no-console
    console.log(`Starting GitHub events polling for ${REPO} at ${new Date().toISOString()}`);
    const result = await pollEvents(COLLECTION_PATH, commonRequestData);
    if (result.success) {
      const {
        metadata
      } = result;
      // eslint-disable-next-line no-console
      console.log(`✅ Successfully collected ${metadata.totalEvents} events for ${REPO}`);
      // eslint-disable-next-line no-console
      console.log(`   ${metadata.eventsWritten} unique events written after deduplication`);
      if (metadata.rateLimitReached) {
        // eslint-disable-next-line no-console
        console.warn('⚠️ GitHub API rate limit was reached during collection');
        // eslint-disable-next-line no-console
        console.warn(`Rate limit will reset at: ${metadata.rateLimitReset}`);
      }
      if (metadata.totalEvents >= fsUtils.MAX_NUMBER_OF_MOST_RECENT_EVENTS) {
        // eslint-disable-next-line no-console
        console.warn(`⚠️ GitHub Events API limit of ${fsUtils.MAX_NUMBER_OF_MOST_RECENT_EVENTS} events was reached`);
        // eslint-disable-next-line no-console
        console.warn('Some events may be missing. Consider polling more frequently.');
      }
      if (metadata.totalEvents === 0) {
        // eslint-disable-next-line no-console
        console.warn('⚠️ No events were collected for today. This might indicate an issue.');
      }

      // Log the date for which we're collecting data
      const today = dateFns.format(new Date(), 'yyyy-MM-dd');
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
