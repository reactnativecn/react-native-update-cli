import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { ZipFile } from 'yazl';
import { inflateRawSync } from 'zlib';
import {
  bundleEntryMatcher,
  fetchBaseBundle,
  sha256Hex,
} from '../src/utils/hermes-base';
import {
  fetchZipEntryData,
  locateZipEntry,
  openRemoteZip,
  parseContentRange,
  readRemoteZipEntry,
  ZIP_DEFLATED,
  ZIP_STORED,
} from '../src/utils/zip-range';

function mkTemp(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function writeZip(
  zipPath: string,
  entries: Record<string, { data: Buffer; compress?: boolean }>,
) {
  const zip = new ZipFile();
  for (const [name, { data, compress }] of Object.entries(entries)) {
    zip.addBuffer(data, name, { compress: compress ?? true });
  }
  zip.end();
  await new Promise<void>((resolve, reject) => {
    zip.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on('close', () => resolve())
      .on('error', reject);
  });
}

/** Static file server; `ranges: false` answers every request with 200. */
function serveFiles(dir: string, ranges = true) {
  const log: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch: async (req) => {
      const file = path.join(dir, new URL(req.url).pathname);
      if (!fs.existsSync(file)) return new Response('nope', { status: 404 });
      const data = fs.readFileSync(file);
      const range = req.headers.get('range');
      log.push(range ?? 'full');
      if (!ranges || !range) return new Response(data);
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return new Response('bad range', { status: 416 });
      let start: number;
      let end: number;
      if (match[1] === '') {
        start = Math.max(0, data.length - Number(match[2]));
        end = data.length - 1;
      } else {
        start = Number(match[1]);
        end = match[2] === '' ? data.length - 1 : Number(match[2]);
      }
      if (start >= data.length || end < start)
        return new Response('bad range', { status: 416 });
      end = Math.min(end, data.length - 1);
      return new Response(data.subarray(start, end + 1), {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${data.length}`,
          'Content-Length': String(end - start + 1),
        },
      });
    },
  });
  return {
    url: (name: string) => `http://127.0.0.1:${server.port}/${name}`,
    log,
    stop: () => server.stop(true),
  };
}

function fakeHbc(version: number, payload: string): Buffer {
  const buf = Buffer.alloc(128 + payload.length);
  Buffer.from('c61fbc03c103191f', 'hex').copy(buf, 0);
  buf.writeUInt32LE(version, 8);
  buf.write(payload, 128);
  return buf;
}

describe('parseContentRange', () => {
  test('accepts bytes a-b/total and rejects malformed values', () => {
    expect(parseContentRange('bytes 10-19/100')).toEqual({
      start: 10,
      end: 19,
      total: 100,
    });
    expect(parseContentRange('bytes 0-99/100')).toEqual({
      start: 0,
      end: 99,
      total: 100,
    });
    expect(parseContentRange('bytes */100')).toBeNull();
    expect(parseContentRange('bytes 10-9/100')).toBeNull();
    expect(parseContentRange('bytes 0-100/100')).toBeNull();
    expect(parseContentRange(null)).toBeNull();
  });
});

describe('zip-range', () => {
  let dir: string;
  const bundle = fakeHbc(98, 'bundle '.repeat(2000));
  const assets = Buffer.alloc(300 * 1024, 7);
  beforeEach(async () => {
    dir = mkTemp('rnu-zip-range-');
    await writeZip(path.join(dir, 'deflate.ppk'), {
      'assets/big.bin': { data: assets, compress: false },
      'index.bundlejs': { data: bundle },
      'assets/tail.bin': { data: assets, compress: false },
    });
    await writeZip(path.join(dir, 'stored.ppk'), {
      'index.bundlejs': { data: bundle, compress: false },
    });
    await writeZip(path.join(dir, 'native.apk'), {
      'assets/big.bin': { data: assets, compress: false },
      'assets/index.android.bundle': { data: bundle },
    });
  });
  afterEach(() => {
    fs.removeSync(dir);
  });

  test('locateZipEntry points at the compressed bytes of the entry', async () => {
    const ppk = path.join(dir, 'deflate.ppk');
    const location = await locateZipEntry(ppk, (n) => n === 'index.bundlejs');
    expect(location?.compressionMethod).toBe(ZIP_DEFLATED);
    expect(location?.uncompressedSize).toBe(bundle.length);
    const file = fs.readFileSync(ppk);
    const raw = file.subarray(
      location!.dataOffset,
      location!.dataOffset + location!.compressedSize,
    );
    expect(inflateRawSync(raw).equals(bundle)).toBe(true);

    const stored = await locateZipEntry(
      path.join(dir, 'stored.ppk'),
      (n) => n === 'index.bundlejs',
    );
    expect(stored?.compressionMethod).toBe(ZIP_STORED);
    expect(stored?.compressedSize).toBe(bundle.length);
    const storedFile = fs.readFileSync(path.join(dir, 'stored.ppk'));
    expect(
      storedFile
        .subarray(stored!.dataOffset, stored!.dataOffset + bundle.length)
        .equals(bundle),
    ).toBe(true);

    expect(await locateZipEntry(ppk, (n) => n === 'missing')).toBeNull();
  });

  test('fetchZipEntryData downloads only the located bytes', async () => {
    const server = serveFiles(dir);
    try {
      const ppk = path.join(dir, 'deflate.ppk');
      const location = (await locateZipEntry(
        ppk,
        (n) => n === 'index.bundlejs',
      ))!;
      const result = await fetchZipEntryData(
        server.url('deflate.ppk'),
        location,
      );
      expect(result.data.equals(bundle)).toBe(true);
      expect(result.fetchedBytes).toBe(location.compressedSize);
      expect(result.totalBytes).toBe(fs.statSync(ppk).size);
      expect(server.log).toEqual([
        `bytes=${location.dataOffset}-${location.dataOffset + location.compressedSize - 1}`,
      ]);
      // a wrong location yields garbage, not the bundle
      await expect(
        fetchZipEntryData(server.url('deflate.ppk'), {
          ...location,
          dataOffset: location.dataOffset + 1,
        }),
      ).rejects.toThrow();
    } finally {
      server.stop();
    }
  });

  test('openRemoteZip reads an entry through a few Range requests', async () => {
    const server = serveFiles(dir);
    try {
      const remote = await openRemoteZip(server.url('native.apk'));
      expect(remote.kind).toBe('zip');
      if (remote.kind !== 'zip') throw new Error('unreachable');
      const data = await readRemoteZipEntry(
        remote.zipFile,
        bundleEntryMatcher('apk'),
      );
      expect(data?.equals(bundle)).toBe(true);
      const total = fs.statSync(path.join(dir, 'native.apk')).size;
      expect(remote.reader.totalSize).toBe(total);
      // tail + local header chunk (+ data when not covered): far below the archive
      expect(server.log.length).toBeLessThanOrEqual(3);
      expect(server.log[0]).toBe('bytes=-65536');
      expect(remote.reader.fetchedBytes).toBeLessThan(total / 2);

      const missing = await openRemoteZip(server.url('deflate.ppk'));
      if (missing.kind !== 'zip') throw new Error('unreachable');
      expect(
        await readRemoteZipEntry(missing.zipFile, (n) => n === 'nope'),
      ).toBeNull();
    } finally {
      server.stop();
    }
  });

  test('openRemoteZip hands back the full response when Range is ignored', async () => {
    const server = serveFiles(dir, false);
    try {
      const remote = await openRemoteZip(server.url('native.apk'));
      expect(remote.kind).toBe('full');
      if (remote.kind !== 'full') throw new Error('unreachable');
      const body = Buffer.from(await remote.response.arrayBuffer());
      expect(body.equals(fs.readFileSync(path.join(dir, 'native.apk')))).toBe(
        true,
      );
    } finally {
      server.stop();
    }
  });

  describe('fetchBaseBundle', () => {
    const record = (url: string, extra: Record<string, unknown> = {}) => ({
      versionId: 1,
      hash: 'key',
      bundleHash: sha256Hex(bundle),
      bytecodeVersion: 98,
      url,
      ...extra,
    });

    test('uses the reported location with a single request', async () => {
      const server = serveFiles(dir);
      const messages: string[] = [];
      try {
        const location = (await locateZipEntry(
          path.join(dir, 'deflate.ppk'),
          (n) => n === 'index.bundlejs',
        ))!;
        const fetched = await fetchBaseBundle(
          record(server.url('deflate.ppk'), {
            bundleOffset: location.dataOffset,
            bundleCompressedSize: location.compressedSize,
            bundleCompression: location.compressionMethod,
          }),
          'ppk',
          path.join(dir, 'archive.ppk'),
          (m) => messages.push(m),
        );
        expect(fetched?.transport).toBe('range-entry');
        expect(fetched?.bundle.equals(bundle)).toBe(true);
        expect(server.log.length).toBe(1);
        expect(messages).toEqual([]);
        expect(fs.existsSync(path.join(dir, 'archive.ppk'))).toBe(false);
      } finally {
        server.stop();
      }
    });

    test('a stale location falls back to the central directory, then verifies', async () => {
      const server = serveFiles(dir);
      const messages: string[] = [];
      try {
        const fetched = await fetchBaseBundle(
          record(server.url('deflate.ppk'), {
            bundleOffset: 5,
            bundleCompressedSize: 100,
            bundleCompression: ZIP_DEFLATED,
          }),
          'ppk',
          path.join(dir, 'archive.ppk'),
          (m) => messages.push(m),
        );
        expect(fetched?.transport).toBe('range-zip');
        expect(fetched?.bundle.equals(bundle)).toBe(true);
        expect(messages.length).toBe(1);
        expect(messages[0]).toContain('entry range');
      } finally {
        server.stop();
      }
    });

    test('without a location any zip artifact is read through Range', async () => {
      const server = serveFiles(dir);
      try {
        const fetched = await fetchBaseBundle(
          record(server.url('native.apk'), { artifactType: 'apk' }),
          'apk',
          path.join(dir, 'archive.apk'),
        );
        expect(fetched?.transport).toBe('range-zip');
        expect(fetched?.bundle.equals(bundle)).toBe(true);
        expect(fs.existsSync(path.join(dir, 'archive.apk'))).toBe(false);
      } finally {
        server.stop();
      }
    });

    test('a server that ignores Range costs exactly one full download', async () => {
      const server = serveFiles(dir, false);
      const messages: string[] = [];
      try {
        const location = (await locateZipEntry(
          path.join(dir, 'deflate.ppk'),
          (n) => n === 'index.bundlejs',
        ))!;
        const fetched = await fetchBaseBundle(
          record(server.url('deflate.ppk'), {
            bundleOffset: location.dataOffset,
            bundleCompressedSize: location.compressedSize,
            bundleCompression: location.compressionMethod,
          }),
          'ppk',
          path.join(dir, 'archive.ppk'),
          (m) => messages.push(m),
        );
        expect(fetched?.transport).toBe('full');
        expect(fetched?.bundle.equals(bundle)).toBe(true);
        expect(server.log.length).toBe(1);
        expect(messages.length).toBe(1);
        expect(fs.existsSync(path.join(dir, 'archive.ppk'))).toBe(true);
      } finally {
        server.stop();
      }
    });

    test('a bundleHash mismatch on the Range path ends in the full download', async () => {
      const server = serveFiles(dir);
      const messages: string[] = [];
      try {
        const fetched = await fetchBaseBundle(
          record(server.url('deflate.ppk'), { bundleHash: 'f'.repeat(64) }),
          'ppk',
          path.join(dir, 'archive.ppk'),
          (m) => messages.push(m),
        );
        // the full path leaves verification to the caller
        expect(fetched?.transport).toBe('full');
        expect(fetched?.bundle.equals(bundle)).toBe(true);
        expect(messages[0]).toContain('bundleHash mismatch');
        expect(server.log[server.log.length - 1]).toBe('full');
      } finally {
        server.stop();
      }
    });

    test('a missing object fails instead of falling back', async () => {
      const server = serveFiles(dir);
      try {
        await expect(
          fetchBaseBundle(
            record(server.url('missing.ppk')),
            'ppk',
            path.join(dir, 'archive.ppk'),
          ),
        ).rejects.toThrow();
      } finally {
        server.stop();
      }
    });
  });
});
