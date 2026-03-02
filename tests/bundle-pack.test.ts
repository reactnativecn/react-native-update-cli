import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { open as openZipFile } from 'yauzl';
import { packBundle } from '../src/bundle-pack';

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function listZipEntries(zipPath: string): Promise<string[]> {
  const entries: string[] = [];
  await new Promise<void>((resolve, reject) => {
    openZipFile(zipPath, { lazyEntries: true }, (error, zipfile) => {
      if (error || !zipfile) {
        reject(error ?? new Error('Failed to open zip file'));
        return;
      }

      zipfile.on('entry', (entry) => {
        entries.push(entry.fileName);
        zipfile.readEntry();
      });
      zipfile.once('end', () => resolve());
      zipfile.once('error', reject);

      zipfile.readEntry();
    });
  });
  return entries;
}

describe('bundle-pack', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-pack-bundle-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('packs bundle and excludes ignored files', async () => {
    const sourceDir = path.join(tempRoot, 'bundle');
    const nestedDir = path.join(sourceDir, 'assets');
    fs.mkdirSync(nestedDir, { recursive: true });

    fs.writeFileSync(path.join(sourceDir, 'index.bundlejs'), 'bundle');
    fs.writeFileSync(path.join(sourceDir, 'index.bundlejs.map'), 'ignored-map');
    fs.writeFileSync(
      path.join(sourceDir, 'bundle.harmony.js.map'),
      'ignored-map',
    );
    fs.writeFileSync(path.join(sourceDir, 'keep.txt'), 'keep');
    fs.writeFileSync(path.join(sourceDir, 'ignored.txt.map'), 'ignored-map');
    fs.writeFileSync(path.join(sourceDir, '.DS_Store'), 'ignored');
    fs.writeFileSync(path.join(nestedDir, 'image.png'), 'image-content');

    const outputZip = path.join(tempRoot, 'dist', 'output.ppk');
    await packBundle(sourceDir, outputZip);

    expect(fs.existsSync(outputZip)).toBe(true);

    const entries = await listZipEntries(outputZip);
    expect(entries).toContain('index.bundlejs');
    expect(entries).toContain('keep.txt');
    expect(entries).toContain('assets/');
    expect(entries).toContain('assets/image.png');

    expect(entries).not.toContain('index.bundlejs.map');
    expect(entries).not.toContain('bundle.harmony.js.map');
    expect(entries).not.toContain('ignored.txt.map');
    expect(entries).not.toContain('.DS_Store');
  });
});
