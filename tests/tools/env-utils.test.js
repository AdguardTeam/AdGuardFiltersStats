import { parseRepo, requireEnvVars } from '../../src/tools/env-utils';

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

describe('parseRepo', () => {
    it('returns the owner and the repository name', () => {
        expect(parseRepo('AdguardTeam/AdguardFilters')).toEqual({
            owner: 'AdguardTeam',
            repo: 'AdguardFilters',
        });
    });

    it('rejects a value without a slash', () => {
        expect(() => parseRepo('AdguardFilters'))
            .toThrow('REPO must be in owner/repo_name form, got "AdguardFilters"');
    });

    it('rejects an empty owner or repository name', () => {
        expect(() => parseRepo('/AdguardFilters')).toThrow(/owner\/repo_name form/);
        expect(() => parseRepo('AdguardTeam/')).toThrow(/owner\/repo_name form/);
        expect(() => parseRepo('a/b/c')).toThrow(/owner\/repo_name form/);
    });
});
