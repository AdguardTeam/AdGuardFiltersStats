jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/prepare-stats', () => ({
    // The main work always fails, so the catch path needs no extra setup.
    prepareStats: jest.fn(async () => {
        throw new Error('Request failed\nwith a body: <html>');
    }),
}));
jest.mock('../src/print-stats/print-stats', () => ({ printStats: jest.fn() }));

// eslint-disable-next-line import/first
import { prepareStats } from '../src/prepare-stats';

const REQUIRED_ENV_VARS = ['COLLECTION_PATH', 'REPO'];

describe('github-stats entry', () => {
    const savedEnv = {};
    let consoleErrorSpy;
    let exitSpy;

    const loadEntry = () => {
        // The entry runs on import, so every case loads a fresh copy.
        // eslint-disable-next-line global-require
        jest.isolateModules(() => require('../src/github-stats'));
    };

    const flushPromises = () => new Promise((resolve) => {
        setImmediate(resolve);
    });

    beforeEach(() => {
        REQUIRED_ENV_VARS.forEach((name) => {
            savedEnv[name] = process.env[name];
            delete process.env[name];
        });
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        exitSpy.mockRestore();
        REQUIRED_ENV_VARS.forEach((name) => {
            if (savedEnv[name] === undefined) {
                delete process.env[name];
            } else {
                process.env[name] = savedEnv[name];
            }
        });
    });

    it('prints one line and exits with code 1 when a required variable is absent', () => {
        loadEntry();

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const [line] = consoleErrorSpy.mock.calls[0];
        expect(line).toContain('COLLECTION_PATH, REPO environment variables must be set');
        // One line, no stack trace.
        expect(line.split('\n')).toHaveLength(1);
    });

    it('names only the variable that is absent', () => {
        process.env.COLLECTION_PATH = './stats-data';

        loadEntry();

        expect(exitSpy).toHaveBeenCalledWith(1);
        const [line] = consoleErrorSpy.mock.calls[0];
        expect(line).toContain('REPO environment variable must be set');
        expect(line.split('\n')).toHaveLength(1);
    });

    it('prints the failure of the main work on one line and exits with code 1', async () => {
        process.env.COLLECTION_PATH = './stats-data';
        process.env.REPO = 'a/b';

        loadEntry();
        await flushPromises();

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const [line] = consoleErrorSpy.mock.calls[0];
        // `normalizeErrorMessage` collapses the body into one line.
        expect(line).toContain('Request failed with a body: <html>');
        expect(line.split('\n')).toHaveLength(1);
    });

    it('does not exit when the main work succeeds', async () => {
        prepareStats.mockResolvedValueOnce({});
        process.env.COLLECTION_PATH = './stats-data';
        process.env.REPO = 'a/b';

        loadEntry();
        await flushPromises();

        expect(exitSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
});
