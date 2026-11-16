import { mkdtemp, writeFile, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import {
    readMetadataRecords,
    writePollToCollection,
    mergeSyntheticEventsIntoCollection,
} from '../../src/tools/fs-utils';

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

describe('write failures reach the caller as rejections', () => {
    // A non-writable path blocks the write only for a non-root user, so the
    // assertions below have nothing to prove when the suite runs as root.
    const canBeBlocked = typeof process.getuid === 'function' && process.getuid() !== 0;
    const itUnlessRoot = canBeBlocked ? it : it.skip;

    const event = {
        id: 'evt-1',
        type: 'IssuesEvent',
        created_at: '2026-04-21T06:31:14Z',
        actor: { login: 'user1' },
        payload: { action: 'opened', issue: {} },
    };

    itUnlessRoot('writePollToCollection rejects with EACCES for a read-only collection', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'fs-ro-poll-'));
        await chmod(dir, 0o555);
        try {
            // The chain re-emits the write-stream error; without a listener on
            // the chain this is an unhandled `error` event and the process dies.
            await expect(writePollToCollection(dir, [event])).rejects.toMatchObject({
                code: 'EACCES',
            });
        } finally {
            await chmod(dir, 0o755);
        }
    });

    itUnlessRoot('mergeSyntheticEventsIntoCollection rejects with EACCES for a read-only collection', async () => {
        const dir = await mkdtemp(path.join(tmpdir(), 'fs-ro-merge-'));
        await chmod(dir, 0o555);
        try {
            await expect(mergeSyntheticEventsIntoCollection(dir, [event])).rejects.toMatchObject({
                code: 'EACCES',
            });
        } finally {
            await chmod(dir, 0o755);
        }
    });
});
