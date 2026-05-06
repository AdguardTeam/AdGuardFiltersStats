/**
 * Prepare general activity by username.
 *
 * @param {object} contributors Contributor instances by username.
 *
 * @returns {object} Object with activity amount by username.
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
