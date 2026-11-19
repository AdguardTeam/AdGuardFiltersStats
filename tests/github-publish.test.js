jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/prepare-stats', () => ({
    prepareStats: jest.fn(async () => ({})),
}));
jest.mock('../src/publish-stats', () => ({
    // The publish call always fails, so the catch path needs no extra setup.
    publishStats: jest.fn(async () => {
        throw new Error('Slack rejected the message\nwith a body: <html>');
    }),
}));

// eslint-disable-next-line import/first
import { publishStats } from '../src/publish-stats';

const REQUIRED_ENV_VARS = [
    'COLLECTION_PATH',
    'REPO',
    'SLACK_OAUTH_TOKEN',
    'SLACK_CHANNEL_ID',
];

describe('github-publish entry', () => {
    const savedEnv = {};
    let consoleErrorSpy;
    let exitSpy;

    const loadEntry = () => {
        // The entry runs on import, so every case loads a fresh copy.
        // eslint-disable-next-line global-require
        jest.isolateModules(() => require('../src/github-publish'));
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

    it('prints one line and exits with code 1 when the required variables are absent', () => {
        loadEntry();

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const [line] = consoleErrorSpy.mock.calls[0];
        expect(line).toContain(
            'COLLECTION_PATH, REPO, SLACK_OAUTH_TOKEN, SLACK_CHANNEL_ID environment variables must be set',
        );
        // One line, no stack trace.
        expect(line.split('\n')).toHaveLength(1);
    });

    it('names only the variables that are absent', () => {
        process.env.COLLECTION_PATH = './stats-data';
        process.env.REPO = 'a/b';

        loadEntry();

        expect(exitSpy).toHaveBeenCalledWith(1);
        const [line] = consoleErrorSpy.mock.calls[0];
        expect(line).toContain('SLACK_OAUTH_TOKEN, SLACK_CHANNEL_ID environment variables must be set');
        expect(line.split('\n')).toHaveLength(1);
    });

    it('prints the failure of the publish call on one line and exits with code 1', async () => {
        process.env.COLLECTION_PATH = './stats-data';
        process.env.REPO = 'a/b';
        process.env.SLACK_OAUTH_TOKEN = 'token';
        process.env.SLACK_CHANNEL_ID = 'channel';

        loadEntry();
        await flushPromises();

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const [line] = consoleErrorSpy.mock.calls[0];
        // `normalizeErrorMessage` collapses the body into one line.
        expect(line).toContain('Slack rejected the message with a body: <html>');
        expect(line.split('\n')).toHaveLength(1);
    });

    it('does not exit when the publish call succeeds', async () => {
        publishStats.mockResolvedValueOnce(undefined);
        process.env.COLLECTION_PATH = './stats-data';
        process.env.REPO = 'a/b';
        process.env.SLACK_OAUTH_TOKEN = 'token';
        process.env.SLACK_CHANNEL_ID = 'channel';

        loadEntry();
        await flushPromises();

        expect(exitSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });
});
