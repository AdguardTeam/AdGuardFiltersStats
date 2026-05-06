/* eslint-disable no-use-before-define */

/**
 * Reduces stream to an array, applying callback to each chunk.
 *
 * @param {object} stream Readable stream.
 * @param {(data: unknown, acc: Array) => (unknown|null)} cb Required, return null to stop the stream.
 * @param {Array} initArray Optional, defaults to empty array.
 *
 * @returns {Promise<Array>} Promise with the reduced array.
 */
const reduceStream = (stream, cb, initArray = []) => {
    if (!stream) {
        return Promise.resolve([]);
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

        /**
         * Processes each chunk of data from the stream.
         * It applies the callback to the chunk and the accumulated result array.
         *
         * @param {unknown} data Chunk of data from the stream.
         */
        function onData(data) {
            const next = processChunk(data);
            if (next === null) {
                stream.destroy();
            }
        }

        /**
         * Handles the end of the stream.
         *
         * @param {Error|null} err Error object if an error occurred, otherwise null.
         */
        function onEnd(err) {
            if (err) {
                reject(err);
            }
            resolve(resultArray);
            cleanup();
        }

        /**
         * Handles the closing of the stream, ensuring that the accumulated result is resolved.
         */
        function onClose() {
            resolve(resultArray);
            cleanup();
        }

        /**
         * Cleans up event listeners to prevent memory leaks after the stream has ended or encountered an error.
         * It removes listeners for 'data', 'end', 'error', and 'close' events.
         */
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
