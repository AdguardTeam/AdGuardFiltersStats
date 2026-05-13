import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { readMetadataRecords } from '../../src/tools/fs-utils';

describe('readMetadataRecords', () => {
    let dir;
    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'meta-corrupt-'));
    });

    it('returns [] when the file does not exist', async () => {
        const result = await readMetadataRecords(path.join(dir, 'missing.json'));
        expect(result).toEqual([]);
    });

    it('returns [] and does not throw when the file contains invalid JSON', async () => {
        const file = path.join(dir, 'corrupt-metadata.json');
        await writeFile(file, '{ truncated', 'utf8');
        const result = await readMetadataRecords(file);
        expect(result).toEqual([]);
    });

    it('migrates a legacy single-object file to a one-element array', async () => {
        const file = path.join(dir, 'legacy-metadata.json');
        await writeFile(file, JSON.stringify({ timestamp: '2026-04-21T01:00:00Z' }), 'utf8');
        const result = await readMetadataRecords(file);
        expect(result).toEqual([{ timestamp: '2026-04-21T01:00:00Z' }]);
    });

    it('reads an existing array file unchanged', async () => {
        const file = path.join(dir, 'array-metadata.json');
        const records = [{ timestamp: '2026-04-21T01:00:00Z' }, { timestamp: '2026-04-21T02:00:00Z' }];
        await writeFile(file, JSON.stringify(records), 'utf8');
        const result = await readMetadataRecords(file);
        expect(result).toEqual(records);
    });
});
