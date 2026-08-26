import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { ZipFile } from 'yazl';
import { enumZipEntries } from '../src/utils/zip-entries';

function zipBuffer(entries: Record<string, Buffer>): Promise<Buffer> {
  const zip = new ZipFile();
  for (const [name, data] of Object.entries(entries)) {
    zip.addBuffer(data, name);
  }
  zip.end();
  const parts: Buffer[] = [];
  return new Promise((resolve, reject) => {
    zip.outputStream
      .on('data', (part: Buffer) => parts.push(part))
      .on('end', () => resolve(Buffer.concat(parts)))
      .on('error', reject);
  });
}

const nestedTempDirs = () =>
  fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('nested_zip_'));

describe('enumZipEntries', () => {
  let dir: string;
  let app: string;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-zip-entries-'));
    app = path.join(dir, 'harmony.app');
    const hap = await zipBuffer({
      'resources/rawfile/bundle.harmony.js': Buffer.from('bundle'),
    });
    fs.writeFileSync(
      app,
      await zipBuffer({ 'entry.hap': hap, 'pack.info': Buffer.from('{}') }),
    );
  });
  afterEach(() => {
    fs.removeSync(dir);
  });

  test('walks into a nested .hap and cleans up its temp dir', async () => {
    const before = nestedTempDirs();
    const seen: string[] = [];
    await enumZipEntries(app, (_entry, _zip, nestedPath) => {
      seen.push(nestedPath ?? '');
      return undefined;
    });
    expect(seen).toEqual([
      'entry.hap/resources/rawfile/bundle.harmony.js',
      'entry.hap',
      'pack.info',
    ]);
    expect(nestedTempDirs()).toEqual(before);
  });

  test('a failing callback rejects once, without logging, and still cleans up', async () => {
    const before = nestedTempDirs();
    const originalError = console.error;
    const logged: unknown[] = [];
    console.error = (...args: unknown[]) => {
      logged.push(args);
    };
    try {
      const failure = new Error('boom');
      const error = await enumZipEntries(app, (_entry, _zip, nestedPath) => {
        if (nestedPath?.includes('/')) throw failure;
        return undefined;
      }).then(
        () => null,
        (e) => e,
      );
      expect(error).toBe(failure);
    } finally {
      console.error = originalError;
    }
    expect(logged).toEqual([]);
    expect(nestedTempDirs()).toEqual(before);
  });
});
