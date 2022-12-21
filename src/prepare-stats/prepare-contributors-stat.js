/**
 * Prepare general activity by username
 * @param {Object<Object<Array>>} contributors Contributor instances by username
 * @return {Object<number>} object with activity amount by username
 */
const prepareActivityStat = (contributors) => {
    const generalContributorStats = {};
    // eslint-disable-next-line no-restricted-syntax
    for (const name of Object.keys(contributors)) {
        generalContributorStats[name] = contributors[name].countTotalActivity();
    }

    return generalContributorStats;
};

exports.prepareActivityStat = prepareActivityStat;
