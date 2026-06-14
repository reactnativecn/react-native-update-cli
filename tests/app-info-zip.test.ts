import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ZipFile as YazlZipFile } from 'yazl';
import { IpaParser } from '../src/utils/app-info-parser/ipa';
import { Zip } from '../src/utils/app-info-parser/zip';

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function writeZip(
  zipPath: string,
  entries: Record<string, string | Buffer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const zipFile = new YazlZipFile();
    for (const [name, content] of Object.entries(entries)) {
      zipFile.addBuffer(
        Buffer.isBuffer(content) ? content : Buffer.from(content),
        name,
      );
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

  test('parses ipa plist with current plist package exports', async () => {
    const ipaPath = path.join(tempRoot, 'app.ipa');
    await writeZip(ipaPath, {
      'Payload/Test.app/Info.plist': `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>cn.reactnative.test</string>
  <key>CFBundleShortVersionString</key>
  <string>1.2.3</string>
</dict>
</plist>`,
      'Payload/Test.app/embedded.mobileprovision': `prefix
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>TeamName</key>
  <string>ReactNativeCN</string>
</dict>
</plist>
suffix`,
    });

    const info = await new IpaParser(ipaPath).parse();

    expect(info.CFBundleIdentifier).toBe('cn.reactnative.test');
    expect(info.CFBundleShortVersionString).toBe('1.2.3');
    expect(info.mobileProvision.TeamName).toBe('ReactNativeCN');
    expect(info.icon).toBe(null);
  });

  test('getEntry reads a single entry by string and regex', async () => {
    const zipPath = path.join(tempRoot, 'app.zip');
    await writeZip(zipPath, {
      'test.txt': 'hello world',
      'foo.bar': 'baz',
    });

    const zip = new Zip(zipPath);

    // By string
    const buf1 = await zip.getEntry('test.txt');
    expect(Buffer.isBuffer(buf1)).toBe(true);
    expect((buf1 as Buffer).toString()).toBe('hello world');

    // By regex
    const buf2 = await zip.getEntry(/foo.bar/);
    expect(Buffer.isBuffer(buf2)).toBe(true);
    expect((buf2 as Buffer).toString()).toBe('baz');
  });

  test('getEntry and getEntries handle blob return type', async () => {
    const zipPath = path.join(tempRoot, 'app.zip');
    await writeZip(zipPath, {
      'test.txt': 'hello world',
    });

    const zip = new Zip(zipPath);

    const blob1 = await zip.getEntry('test.txt', 'blob');
    expect(blob1).toBeInstanceOf(Blob);
    expect(await (blob1 as Blob).text()).toBe('hello world');

    const buffers = await zip.getEntries(['test.txt'], 'blob');
    expect(buffers['test.txt']).toBeInstanceOf(Blob);
    expect(await (buffers['test.txt'] as Blob).text()).toBe('hello world');
  });

  test('getEntryFromHarmonyApp extracts matching file', async () => {
    const zipPath = path.join(tempRoot, 'app.zip');
    await writeZip(zipPath, {
      'config.json': '{"harmony": true}',
      'other.txt': 'ignore',
    });

    const zip = new Zip(zipPath);

    const buf = await zip.getEntryFromHarmonyApp(/config.json/);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect((buf as Buffer).toString()).toBe('{"harmony": true}');
  });

  test('constructor resolves path for string input', () => {
    const relPath = 'some/relative/path.zip';
    const zip = new Zip(relPath);
    expect(zip.file).toBe(path.resolve(relPath));
  });

  test('throws error when reading entries and file is not a string', async () => {
    // Simulate a File object which is not a string
    const mockFile = new Blob(['dummy']) as File;
    const zip = new Zip(mockFile);

    expect(zip.file).toBe(mockFile);

    try {
      await zip.getEntry('any');
      expect(true).toBe(false); // Should not reach here
    } catch (e: any) {
      expect(e.message).toBe('Param error: [file] must be file path in Node.');
    }

    try {
      await zip.getEntries(['any']);
      expect(true).toBe(false); // Should not reach here
    } catch (e: any) {
      expect(e.message).toBe('Param error: [file] must be file path in Node.');
    }

    // getEntryFromHarmonyApp catches the error and logs to console, returning undefined
    const originalError = console.error;
    let consoleOutput = '';
    console.error = (_msg: string, err: any) => {
      consoleOutput += err.message;
    };
    const res = await zip.getEntryFromHarmonyApp(/any/);
    console.error = originalError;

    expect(res).toBeUndefined();
    expect(consoleOutput).toBe(
      'Param error: [file] must be file path in Node.',
    );
  });
});
