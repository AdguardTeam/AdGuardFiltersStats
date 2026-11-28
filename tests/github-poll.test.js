jest.mock('dotenv/config', () => ({}));
jest.mock('../src/poll-events', () => ({
    pollEvents: jest.fn(),
}));

// eslint-disable-next-line import/first
import { pollEvents } from '../src/poll-events';

const REQUIRED_ENV_VARS = ['COLLECTION_PATH', 'REPO'];

describe('github-poll entry', () => {
    const savedEnv = {};
    let consoleLogSpy;
    let consoleWarnSpy;
    let consoleErrorSpy;
    let exitSpy;

    const loadEntry = () => {
        // The entry runs on import, so every case loads a fresh copy.
        // eslint-disable-next-line global-require
        jest.isolateModules(() => require('../src/github-poll'));
    };

    const flushPromises = () => new Promise((resolve) => {
        setImmediate(resolve);
    });

    beforeEach(() => {
        REQUIRED_ENV_VARS.forEach((name) => {
            savedEnv[name] = process.env[name];
            process.env[name] = name === 'REPO' ? 'a/b' : './stats-data';
        });
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleWarnSpy.mockRestore();
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
        delete process.env.REPO;

        loadEntry();

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const [line] = consoleErrorSpy.mock.calls[0];
        expect(line).toContain('REPO environment variable must be set');
        // One line, no stack trace.
        expect(line.split('\n')).toHaveLength(1);
    });

    it('exits with code 1 when the poll fails', async () => {
        // The real failure shape: a failed poll always carries an `error` and
        // the metadata of the run.
        pollEvents.mockResolvedValueOnce({
            success: false,
            error: 'rate limit',
            metadata: {
                timestamp: new Date().toISOString(),
                error: 'rate limit',
                rateLimitReached: true,
                rateLimitReset: null,
            },
        });

        loadEntry();
        await flushPromises();

        expect(exitSpy).toHaveBeenCalledWith(1);
        // One line, no stack trace and no metadata dump. This entry is the
        // only place that reports the reason.
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            '❌ Failed to collect GitHub events: rate limit',
        );
    });

    it('prints one line and exits with code 1 when REPO has no owner part', () => {
        process.env.REPO = 'no-slash';

        loadEntry();

        expect(exitSpy).toHaveBeenCalledWith(1);
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        const [line] = consoleErrorSpy.mock.calls[0];
        expect(line).toContain('REPO must be in owner/repo_name form');
        expect(line.split('\n')).toHaveLength(1);
    });

    it('does not exit when an empty batch succeeds', async () => {
        // The acceptance criterion is an exit code of 0 for a quiet poll, which
        // is the absence of a call to `process.exit`.
        pollEvents.mockResolvedValueOnce({
            success: true,
            metadata: { totalEvents: 0, eventsInFile: 0 },
        });

        loadEntry();
        await flushPromises();

        expect(exitSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        const lines = consoleLogSpy.mock.calls.map((call) => call[0]);
        expect(lines).toContain('✅ Successfully fetched 0 events for a/b');
        // A quiet poll is information, not a warning.
        expect(lines).toContain(
            'GitHub returned no events. This can be normal for a quiet repository.',
        );
        expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
});
