import { requireEnvVars } from '../../src/tools/env-utils';

describe('requireEnvVars', () => {
    it('returns the values of the required variables', () => {
        const env = { COLLECTION_PATH: './stats-data', REPO: 'a/b', OTHER: 'x' };

        expect(requireEnvVars(['COLLECTION_PATH', 'REPO'], env)).toEqual({
            COLLECTION_PATH: './stats-data',
            REPO: 'a/b',
        });
    });

    it('names a single missing variable', () => {
        expect(() => requireEnvVars(['REPO'], { COLLECTION_PATH: './stats-data' }))
            .toThrow('REPO environment variable must be set');
    });

    it('names every missing variable in one line', () => {
        const env = { OTHER: 'x' };

        expect(() => requireEnvVars(['COLLECTION_PATH', 'REPO'], env))
            .toThrow('COLLECTION_PATH, REPO environment variables must be set');
    });

    it('treats an empty value as missing', () => {
        expect(() => requireEnvVars(['REPO'], { REPO: '' }))
            .toThrow('REPO environment variable must be set');
    });
});
