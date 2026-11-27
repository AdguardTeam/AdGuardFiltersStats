import {
    mkdtemp, writeFile, chmod, readdir,
} from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { format, subDays } from 'date-fns';
import {
    getEventsFromCollection,
    readMetadataRecords,
    removeOldFilesFromCollection,
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

describe('getEventsFromCollection', () => {
    let dir;

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'fs-collection-'));
    });

    const writeDay = async (day, id) => {
        await writeFile(
            path.join(dir, `${day}.jsonl`),
            `${JSON.stringify({ id, created_at: `${day}T12:00:00Z` })}\n`,
            'utf8',
        );
    };

    it('reads every stored day when since is absent and ignores the sidecar', async () => {
        await writeDay('2026-11-01', 'first');
        await writeDay('2026-11-02', 'second');
        // A real collection has a sidecar next to every day file. The read
        // must not treat it as a day file.
        await writeFile(
            path.join(dir, '2026-11-01-metadata.json'),
            JSON.stringify([{ timestamp: '2026-11-01T12:00:00Z' }]),
            'utf8',
        );

        // No bounds at all: an unwanted sidecar read would reach the result.
        const events = await getEventsFromCollection(dir, {});

        expect(events.map((event) => event.id)).toEqual(['first', 'second']);
    });

    it('limits the read to the requested days when since is present', async () => {
        await writeDay('2026-11-01', 'outside');
        await writeDay('2026-11-02', 'inside');

        const events = await getEventsFromCollection(dir, {
            since: '2026-11-02T00:00:00Z',
            until: '2026-11-02T23:59:59Z',
        });

        expect(events.map((event) => event.id)).toEqual(['inside']);
    });

    it('returns no events when the collection directory is absent', async () => {
        const events = await getEventsFromCollection(path.join(dir, 'missing'), {
            until: '9999-12-31T23:59:59Z',
        });

        expect(events).toEqual([]);
    });
});

describe('removeOldFilesFromCollection', () => {
    let dir;
    const day = (daysAgo) => format(subDays(new Date(), daysAgo), 'yyyy-MM-dd');

    beforeEach(async () => {
        dir = await mkdtemp(path.join(tmpdir(), 'fs-cleanup-'));
    });

    it('removes an expired day file together with its metadata sidecar', async () => {
        const staleDay = day(31);
        await writeFile(path.join(dir, `${staleDay}.jsonl`), '', 'utf8');
        await writeFile(path.join(dir, `${staleDay}-metadata.json`), '[]', 'utf8');

        await removeOldFilesFromCollection(dir, 30);

        expect(await readdir(dir)).toEqual([]);
    });

    it('keeps a current day file and its metadata sidecar', async () => {
        const recentDay = day(1);
        const filenames = [`${recentDay}.jsonl`, `${recentDay}-metadata.json`];
        await Promise.all(filenames.map((filename) => writeFile(
            path.join(dir, filename),
            filename.endsWith('.jsonl') ? '' : '[]',
            'utf8',
        )));

        await removeOldFilesFromCollection(dir, 30);

        expect((await readdir(dir)).sort()).toEqual(filenames.sort());
    });

    it('removes an expired sidecar even without a matching day file', async () => {
        const staleDay = day(31);
        await writeFile(path.join(dir, `${staleDay}-metadata.json`), '[]', 'utf8');

        await removeOldFilesFromCollection(dir, 30);

        expect(await readdir(dir)).toEqual([]);
    });

    it('leaves files that are not part of the collection', async () => {
        await writeFile(path.join(dir, 'notes.txt'), 'keep', 'utf8');
        await writeFile(path.join(dir, '2020-01-01.bak'), 'keep', 'utf8');

        await removeOldFilesFromCollection(dir, 30);

        expect((await readdir(dir)).sort()).toEqual(['2020-01-01.bak', 'notes.txt']);
    });
});
