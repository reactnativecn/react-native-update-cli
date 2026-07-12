import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ZipFile as YazlZipFile } from 'yazl';
import {
  createSlimNativePackage,
  resolveNativePackageEntry,
} from '../src/native-package';
import { enumZipEntries, readEntry } from '../src/utils/zip-entries';

async function createZip(
  output: string,
  entries: Record<string, string | Buffer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const zipFile = new YazlZipFile();
    zipFile.outputStream.once('error', reject);
    zipFile.outputStream
      .pipe(fs.createWriteStream(output))
      .once('error', reject)
      .once('close', () => resolve());

    for (const [entryName, value] of Object.entries(entries)) {
      zipFile.addBuffer(
        Buffer.isBuffer(value) ? value : Buffer.from(value),
        entryName,
      );
    }
    zipFile.end();
  });
}

async function readZipFiles(filePath: string): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  await enumZipEntries(filePath, async (entry, zipFile, nestedPath) => {
    if (!entry.fileName.endsWith('/')) {
      files[nestedPath || entry.fileName] = await readEntry(entry, zipFile);
    }
  });
  return files;
}

describe('native package baseline extraction', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-native-package-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('uses one resolver for diff paths and extraction eligibility', () => {
    expect(
      resolveNativePackageEntry(
        'ios',
        'Payload/Test.app/assets/images/icon.png',
      ),
    ).toEqual({
      diffPath: 'assets/images/icon.png',
      kind: 'resource',
    });
    expect(
      resolveNativePackageEntry('ios', 'Payload/Test.app/Frameworks/RN'),
    ).toBeUndefined();
    expect(
      resolveNativePackageEntry('android', 'assets/index.android.bundle')?.kind,
    ).toBe('bundle');
    expect(
      resolveNativePackageEntry('android', 'res/drawable/icon.png')?.kind,
    ).toBe('resource');
    expect(
      resolveNativePackageEntry('harmony', 'resources/rawfile/assets/icon.png')
        ?.kind,
    ).toBe('resource');
  });

  test('repackages an APK with only the bundle and diffable resources', async () => {
    const source = path.join(tempRoot, 'source.apk');
    const output = path.join(tempRoot, 'slim.apk');
    await createZip(source, {
      'AndroidManifest.xml': 'manifest',
      'assets/index.android.bundle': 'bundle',
      'assets/data/config.json': 'config',
      'classes.dex': 'native-code',
      'lib/arm64-v8a/libapp.so': 'native-library',
      'res/drawable-xhdpi-v4/icon.webp': 'image',
      'resources.arsc': 'resource-table',
    });

    await createSlimNativePackage(source, output, 'android');

    const files = await readZipFiles(output);
    expect(Object.keys(files).sort()).toEqual([
      'assets/data/config.json',
      'assets/index.android.bundle',
      'res/drawable-xhdpi-v4/icon.webp',
    ]);
    expect(files['assets/index.android.bundle'].toString()).toBe('bundle');
  });

  test('keeps IPA paths while dropping native executables and frameworks', async () => {
    const source = path.join(tempRoot, 'source.ipa');
    const output = path.join(tempRoot, 'slim.ipa');
    await createZip(source, {
      'Payload/Test.app/Test': 'executable',
      'Payload/Test.app/Frameworks/Hermes.framework/Hermes': 'framework',
      'Payload/Test.app/assets/icon.png': 'image',
      'Payload/Test.app/main.jsbundle': 'bundle',
      'SwiftSupport/libswiftCore.dylib': 'swift-runtime',
    });

    await createSlimNativePackage(source, output, 'ios');

    const files = await readZipFiles(output);
    expect(Object.keys(files).sort()).toEqual([
      'Payload/Test.app/assets/icon.png',
      'Payload/Test.app/main.jsbundle',
    ]);
  });

  test('rebuilds nested HAP archives without flattening the APP layout', async () => {
    const hap = path.join(tempRoot, 'entry.hap');
    const source = path.join(tempRoot, 'source.app');
    const output = path.join(tempRoot, 'slim.app');
    await createZip(hap, {
      'ets/modules.abc': 'native-code',
      'resources/rawfile/assets/icon.png': 'image',
      'resources/rawfile/bundle.harmony.js': 'bundle',
      'resources/rawfile/update.json': 'credentials',
    });
    await createZip(source, {
      'entry-default-signed.hap': fs.readFileSync(hap),
      'pack.info': 'metadata',
    });

    await createSlimNativePackage(source, output, 'harmony');

    const files = await readZipFiles(output);
    expect(files['entry-default-signed.hap']).toBeDefined();
    expect(
      files[
        'entry-default-signed.hap/resources/rawfile/bundle.harmony.js'
      ].toString(),
    ).toBe('bundle');
    expect(
      files['entry-default-signed.hap/resources/rawfile/assets/icon.png'],
    ).toBeDefined();
    expect(
      files['entry-default-signed.hap/resources/rawfile/update.json'],
    ).toBeUndefined();
    expect(files['pack.info']).toBeUndefined();
  });

  test('rejects a package when the shared rules find no bundle', async () => {
    const source = path.join(tempRoot, 'source.apk');
    const output = path.join(tempRoot, 'slim.apk');
    await createZip(source, {
      'assets/icon.png': 'image',
      'classes.dex': 'native-code',
    });

    await expect(
      createSlimNativePackage(source, output, 'android'),
    ).rejects.toThrow('Bundle entry not found');
    expect(fs.existsSync(output)).toBe(false);
  });
});
