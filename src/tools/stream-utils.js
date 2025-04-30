/* eslint-disable no-use-before-define */

/**
 * Reduces stream to an array, applying callback to each chunk
 * @param {Object} stream
 * @param {callback} cb required, return null to stop the stream
 * @param {Array} initArray optional, defaults to empty array
 * @return {Promise<Array<Object>>} array with event objects
 */
const reduceStream = (stream, cb, initArray = []) => {
    if (!stream) {
        return;
    }
    const resultArray = [...initArray];
    // Bind callback to the local accum array
    const processChunk = (data) => {
        return cb(data, resultArray);
    };

    // eslint-disable-next-line consistent-return
    return new Promise((resolve, reject) => {
        // stream has already ended
        if (!stream.readable) {
            resolve([]);
        }

        function onData(data) {
            const next = processChunk(data);
            if (next === null) {
                stream.destroy();
            }
        }

        function onEnd(err) {
            if (err) {
                reject(err);
            }
            resolve(resultArray);
            cleanup();
        }

        function onClose() {
            resolve(resultArray);
            cleanup();
        }

        function cleanup() {
            stream.removeListener('data', onData);
            stream.removeListener('end', onEnd);
            stream.removeListener('error', onEnd);
            stream.removeListener('close', onClose);
        }

        stream.on('data', onData);
        stream.on('end', onEnd);
        stream.on('error', onEnd);
        stream.on('close', onClose);
    });
};

export {
    reduceStream,
};
