import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ZipFile as YazlZipFile } from 'yazl';
import { Zip } from '../src/utils/app-info-parser/zip';

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function writeZip(
  zipPath: string,
  entries: Record<string, string>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const zipFile = new YazlZipFile();
    for (const [name, content] of Object.entries(entries)) {
      zipFile.addBuffer(Buffer.from(content), name);
    }
    zipFile.outputStream.on('error', reject);
    zipFile.outputStream.pipe(fs.createWriteStream(zipPath)).on('close', () => {
      resolve();
    });
    zipFile.end();
  });
}

describe('app-info-parser Zip', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-app-info-zip-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('reads entries by regex and string with compatible keys', async () => {
    const zipPath = path.join(tempRoot, 'app.zip');
    await writeZip(zipPath, {
      'AndroidManifest.xml': 'manifest',
      'res/icon.png': 'icon',
    });

    const manifestRegex = /^androidmanifest\.xml$/;
    const buffers = await new Zip(zipPath).getEntries([
      manifestRegex,
      'res/icon.png',
    ]);

    expect(Buffer.isBuffer(buffers[manifestRegex as any])).toBe(true);
    expect((buffers[manifestRegex as any] as Buffer).toString()).toBe(
      'manifest',
    );
    expect((buffers['res/icon.png'] as Buffer).toString()).toBe('icon');
  });
});
