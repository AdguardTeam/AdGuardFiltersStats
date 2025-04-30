/* eslint-disable no-console */
import {
    repoStatToString,
    activityToString,
    detailedActivityToString,
} from '../tools/print-utils';

/**
 * Prepares statistics strings and prints them to console
 *
 * @param {Object} statistics
 */
export const printStats = (statistics) => {
    const {
        repoStat,
        activityStat,
        activitiesByUser,
        activitiesByTime,
    } = statistics;

    const generalRepoStatsString = repoStatToString(repoStat);
    const generalActivityString = activityToString(activityStat);
    const detailedActivityString = detailedActivityToString(activitiesByUser, activitiesByTime);

    console.log(generalRepoStatsString);
    console.log(generalActivityString);
    console.log(detailedActivityString);
};
