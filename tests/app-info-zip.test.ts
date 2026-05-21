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
});
