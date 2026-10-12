import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ZipFile as YazlZipFile } from 'yazl';
import * as api from '../src/api';
import { choosePackage, packageCommands } from '../src/package';
import * as utils from '../src/utils';
import { enumZipEntries } from '../src/utils/zip-entries';

async function createZip(
  output: string,
  entries: Record<string, string>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const zipFile = new YazlZipFile();
    zipFile.outputStream.once('error', reject);
    zipFile.outputStream
      .pipe(fs.createWriteStream(output))
      .once('error', reject)
      .once('close', () => resolve());
    for (const [entryName, value] of Object.entries(entries)) {
      zipFile.addBuffer(Buffer.from(value), entryName);
    }
    zipFile.end();
  });
}

describe('packageCommands.deletePackage', () => {
  let consoleSpy: ReturnType<typeof spyOn>;
  let deleteSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    deleteSpy = spyOn(api, 'doDelete').mockResolvedValue({});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    deleteSpy.mockRestore();
  });

  test('deletes one native package through the legacy endpoint', async () => {
    await packageCommands.deletePackage({
      options: {
        appId: '100',
        packageId: '10',
      },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/app/100/package/10');
  });

  test('deletes multiple native packages through the batch endpoint', async () => {
    await packageCommands.deletePackage({
      options: {
        appId: '100',
        packageIds: '10,11',
      },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/app/100/package', {
      packageIds: [10, 11],
    });
  });

  test('accepts comma separated ids through the legacy packageId option', async () => {
    await packageCommands.deletePackage({
      options: {
        appId: '100',
        packageId: '10,11',
      },
    });

    expect(deleteSpy).toHaveBeenCalledWith('/app/100/package', {
      packageIds: [10, 11],
    });
  });
});

describe('packageCommands native upload', () => {
  let tempRoot = '';
  let consoleSpy: ReturnType<typeof spyOn>;
  let infoSpy: ReturnType<typeof spyOn>;
  let postSpy: ReturnType<typeof spyOn>;
  let uploadSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-package-upload-'));
    consoleSpy = spyOn(console, 'log').mockImplementation(() => {});
    infoSpy = spyOn(utils, 'getApkInfo').mockResolvedValue({
      versionName: '1.0.0',
      buildTime: 123,
      bundleFile: Buffer.from('var a = 1;'),
    } as never);
    postSpy = spyOn(api, 'post').mockResolvedValue({ id: 9 });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    infoSpy.mockRestore();
    postSpy.mockRestore();
    uploadSpy?.mockRestore();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  test('uploads the temporary slim package and removes it afterwards', async () => {
    const source = path.join(tempRoot, 'source.apk');
    await createZip(source, {
      'AndroidManifest.xml': 'manifest',
      'assets/index.android.bundle': 'bundle',
      'classes.dex': 'native-code',
      'res/drawable/icon.png': 'image',
    });

    let uploadedPath = '';
    uploadSpy = spyOn(api, 'uploadFile').mockImplementation(
      async (filePath) => {
        uploadedPath = filePath;
        expect(filePath).not.toBe(source);
        expect(path.extname(filePath)).toBe('.apk');

        const entries: string[] = [];
        await enumZipEntries(filePath, async (entry) => {
          if (!entry.fileName.endsWith('/')) {
            entries.push(entry.fileName);
          }
        });
        expect(entries.sort()).toEqual([
          'assets/index.android.bundle',
          'res/drawable/icon.png',
        ]);
        return { hash: 'slim-package-hash' } as never;
      },
    );

    await packageCommands.uploadApk({
      args: [source],
      options: { appId: '100' },
    });

    expect(uploadSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(
      '/app/100/package/create',
      expect.objectContaining({
        buildTime: '123',
        hash: 'slim-package-hash',
        name: '1.0.0',
        // the embedded bundle is plain JS
        bytecodeVersion: 0,
      }),
    );
    expect(fs.existsSync(uploadedPath)).toBe(false);
  });

  test('removes the temporary slim package when upload fails', async () => {
    const source = path.join(tempRoot, 'source.apk');
    await createZip(source, {
      'assets/index.android.bundle': 'bundle',
    });

    let uploadedPath = '';
    uploadSpy = spyOn(api, 'uploadFile').mockImplementation(
      async (filePath) => {
        uploadedPath = filePath;
        throw new Error('upload failed');
      },
    );

    await expect(
      packageCommands.uploadApk({
        args: [source],
        options: { appId: '100' },
      }),
    ).rejects.toThrow('upload failed');

    expect(fs.existsSync(uploadedPath)).toBe(false);
    expect(postSpy).not.toHaveBeenCalled();
  });
});

describe('choosePackage', () => {
  afterEach(() => {
    global.NO_INTERACTIVE = undefined;
  });

  test('fails instead of looping forever when nothing can answer', async () => {
    global.NO_INTERACTIVE = true;
    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    try {
      await expect(
        choosePackage('100', [{ id: 1, name: '1.0.0' }]),
      ).rejects.toThrow();
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});
