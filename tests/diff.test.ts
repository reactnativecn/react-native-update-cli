import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import { npm, yarn } from 'global-dirs';
import os from 'os';
import path from 'path';
import { ZipFile as YazlZipFile } from 'yazl';
import { diffCommands, enumZipEntries, readEntry } from '../src/diff';
import type { CommandContext } from '../src/types';
import { readEntryPrefix } from '../src/utils/zip-entries';

const pngPrefix = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const hermesBytecodePrefix = Buffer.from([
  0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f,
]);

type ZipContent = {
  entries: string[];
  files: Record<string, Buffer>;
  compressionMethods: Record<string, number>;
};

type DiffContextOptions = {
  output?: unknown;
  customDiff?: (oldSource?: Buffer, newSource?: Buffer) => Buffer;
  customHdiffModule?: {
    diff?: (oldSource?: Buffer, newSource?: Buffer) => Buffer;
  };
} & Record<string, unknown>;

function mkTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function createZip(
  zipPath: string,
  entries: Record<string, string | Buffer>,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const zipFile = new YazlZipFile();
    zipFile.outputStream.on('error', reject);
    zipFile.outputStream
      .pipe(fs.createWriteStream(zipPath))
      .on('close', () => resolve(void 0))
      .on('error', reject);

    for (const [name, content] of Object.entries(entries)) {
      if (name.endsWith('/')) {
        zipFile.addEmptyDirectory(name);
      } else {
        const buffer = Buffer.isBuffer(content)
          ? content
          : Buffer.from(content);
        zipFile.addBuffer(buffer, name);
      }
    }
    zipFile.end();
  });
}

async function readZipContent(zipPath: string): Promise<ZipContent> {
  const content: ZipContent = {
    entries: [],
    files: {},
    compressionMethods: {},
  };

  await enumZipEntries(zipPath, async (entry, zipFile) => {
    content.entries.push(entry.fileName);
    content.compressionMethods[entry.fileName] = entry.compressionMethod;
    if (!entry.fileName.endsWith('/')) {
      content.files[entry.fileName] = await readEntry(entry, zipFile);
    }
  });

  return content;
}

function createContext(
  args: string[],
  options: DiffContextOptions,
): CommandContext {
  return {
    args,
    options,
  };
}

function hasDiffModule(pkgName: string): boolean {
  try {
    require.resolve(pkgName, { paths: ['.', npm.packages, yarn.packages] });
    return true;
  } catch {
    return false;
  }
}

describe('diff commands', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkTempDir('rn-update-diff-');
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test('diff generates patch, copy map, delete map and only changed files', async () => {
    const originPath = path.join(tempRoot, 'origin.ppk');
    const nextPath = path.join(tempRoot, 'next.ppk');
    const outputPath = path.join(tempRoot, 'out', 'diff.ppk');

    await createZip(originPath, {
      'index.bundlejs': 'old-bundle',
      'assets/same.txt': 'same-content',
      'old-only.txt': 'to-delete',
      'moved-source.txt': 'move-content',
    });

    await createZip(nextPath, {
      'index.bundlejs': 'new-bundle',
      'assets/same.txt': 'same-content',
      'moved/newdir/moved-source.txt': 'move-content',
      'newdir/new-file.txt': 'fresh-content',
      'newdir/image.png': 'compressed-image-content',
      'newdir/image-without-extension': Buffer.concat([
        pngPrefix,
        Buffer.from('compressed-image-content'),
      ]),
      'newdir/hermes-misnamed.png': Buffer.concat([
        hermesBytecodePrefix,
        Buffer.from('bundle'),
      ]),
    });

    await diffCommands.diff(
      createContext([originPath, nextPath], {
        output: outputPath,
        customDiff: (oldSource, newSource) =>
          Buffer.from(
            `patch:${oldSource?.toString('utf-8')}:${newSource?.toString('utf-8')}`,
          ),
      }),
    );

    const result = await readZipContent(outputPath);
    expect(result.files['index.bundlejs.patch']?.toString('utf-8')).toBe(
      'patch:old-bundle:new-bundle',
    );
    expect(result.files['newdir/new-file.txt']?.toString('utf-8')).toBe(
      'fresh-content',
    );
    expect(result.files['newdir/image.png']?.toString('utf-8')).toBe(
      'compressed-image-content',
    );
    expect(
      result.files['newdir/image-without-extension']?.subarray(0, 8),
    ).toEqual(pngPrefix);
    expect(result.files['newdir/hermes-misnamed.png']?.subarray(0, 8)).toEqual(
      hermesBytecodePrefix,
    );
    expect(result.files['assets/same.txt']).toBeUndefined();
    expect(result.files['moved/newdir/moved-source.txt']).toBeUndefined();
    expect(result.entries).toContain('moved/');
    expect(result.entries).toContain('moved/newdir/');
    expect(result.compressionMethods['index.bundlejs.patch']).toBe(0);
    expect(result.compressionMethods['__diff.json']).toBe(0);
    expect(result.compressionMethods['newdir/new-file.txt']).toBe(8);
    expect(result.compressionMethods['newdir/image.png']).toBe(0);
    expect(result.compressionMethods['newdir/image-without-extension']).toBe(0);
    expect(result.compressionMethods['newdir/hermes-misnamed.png']).toBe(8);

    const diffMeta = JSON.parse(
      result.files['__diff.json'].toString('utf-8'),
    ) as {
      copies: Record<string, string>;
      deletes: Record<string, 1>;
    };
    expect(diffMeta.copies['moved/newdir/moved-source.txt']).toBe(
      'moved-source.txt',
    );
    expect(diffMeta.deletes['old-only.txt']).toBe(1);
  });

  test('diff throws when origin bundle file is missing', async () => {
    const originPath = path.join(tempRoot, 'origin-no-bundle.ppk');
    const nextPath = path.join(tempRoot, 'next.ppk');
    const outputPath = path.join(tempRoot, 'out', 'missing-bundle.ppk');

    await createZip(originPath, {
      'assets/file.txt': 'hello',
    });
    await createZip(nextPath, {
      'index.bundlejs': 'new-bundle',
    });

    await expect(
      diffCommands.diff(
        createContext([originPath, nextPath], {
          output: outputPath,
          customDiff: () => Buffer.from('patch'),
        }),
      ),
    ).rejects.toThrow();
  });

  test('diff throws when arguments are missing', async () => {
    await expect(
      diffCommands.diff(
        createContext(['only-origin'], {
          output: path.join(tempRoot, 'out', 'invalid.ppk'),
          customDiff: () => Buffer.from('patch'),
        }),
      ),
    ).rejects.toThrow();
  });

  test('diffFromIpa applies path transform and produces package-mode copy map', async () => {
    const originPath = path.join(tempRoot, 'origin.ipa');
    const nextPath = path.join(tempRoot, 'next.ppk');
    const outputPath = path.join(tempRoot, 'out', 'ipa-diff.ppk');

    await createZip(originPath, {
      'Payload/MyApp.app/main.jsbundle': 'old-ipa-bundle',
      'Payload/MyApp.app/assets/icon.png': 'icon-content',
      'Payload/MyApp.app/assets/old-name.png': 'rename-content',
    });

    await createZip(nextPath, {
      'index.bundlejs': 'new-ppk-bundle',
      'assets/icon.png': 'icon-content',
      'assets/new-name.png': 'rename-content',
      'assets/new-file.png': 'new-content',
    });

    await diffCommands.diffFromIpa(
      createContext([originPath, nextPath], {
        output: outputPath,
        customDiff: (oldSource, newSource) =>
          Buffer.from(
            `patch:${oldSource?.toString('utf-8')}:${newSource?.toString('utf-8')}`,
          ),
      }),
    );

    const result = await readZipContent(outputPath);
    expect(result.files['index.bundlejs.patch']?.toString('utf-8')).toBe(
      'patch:old-ipa-bundle:new-ppk-bundle',
    );
    expect(result.files['assets/new-file.png']?.toString('utf-8')).toBe(
      'new-content',
    );
    expect(result.files['assets/icon.png']).toBeUndefined();
    expect(result.files['assets/new-name.png']).toBeUndefined();

    const diffMeta = JSON.parse(
      result.files['__diff.json'].toString('utf-8'),
    ) as {
      copies: Record<string, string>;
    };
    expect(diffMeta.copies['assets/icon.png']).toBe('');
    expect(diffMeta.copies['assets/new-name.png']).toBe('assets/old-name.png');
  });

  test('diff supports explicit next directories and avoids duplicate additions', async () => {
    const originPath = path.join(tempRoot, 'origin-dir.ppk');
    const nextPath = path.join(tempRoot, 'next-dir.ppk');
    const outputPath = path.join(tempRoot, 'out', 'dir-diff.ppk');

    await createZip(originPath, {
      'index.bundlejs': 'old-bundle',
    });
    await createZip(nextPath, {
      'index.bundlejs': 'new-bundle',
      'extra/': '',
      'extra/new.txt': 'new-file',
    });

    await diffCommands.diff(
      createContext([originPath, nextPath], {
        output: outputPath,
        customDiff: () => Buffer.from('patch'),
      }),
    );

    const result = await readZipContent(outputPath);
    const extraDirCount = result.entries.filter(
      (entry) => entry === 'extra/',
    ).length;
    expect(extraDirCount).toBe(1);
    expect(result.files['extra/new.txt']?.toString('utf-8')).toBe('new-file');
  });

  test('readEntryPrefix stops large zip entries without surfacing destroy errors', async () => {
    const zipPath = path.join(tempRoot, 'large-entry.ppk');
    const payload = Buffer.alloc(256, 'x');
    await createZip(zipPath, {
      'large-entry.bin': payload,
    });

    let prefix: Buffer | undefined;
    await enumZipEntries(zipPath, async (entry, zipFile) => {
      if (entry.fileName === 'large-entry.bin') {
        prefix = await readEntryPrefix(entry, zipFile, 64);
      }
    });

    expect(prefix).toEqual(payload.subarray(0, 64));
  });

  test('diffFromApk throws when origin package bundle is missing', async () => {
    const originPath = path.join(tempRoot, 'origin-missing-bundle.apk');
    const nextPath = path.join(tempRoot, 'next-for-apk.ppk');
    const outputPath = path.join(tempRoot, 'out', 'apk-missing-bundle.ppk');

    await createZip(originPath, {
      'assets/other.txt': 'no-bundle',
    });
    await createZip(nextPath, {
      'index.bundlejs': 'new-bundle',
    });

    await expect(
      diffCommands.diffFromApk(
        createContext([originPath, nextPath], {
          output: outputPath,
          customDiff: () => Buffer.from('patch'),
        }),
      ),
    ).rejects.toThrow();
  });

  test('diffFromApk writes directory entries from next package', async () => {
    const originPath = path.join(tempRoot, 'origin-dir.apk');
    const nextPath = path.join(tempRoot, 'next-dir-apk.ppk');
    const outputPath = path.join(tempRoot, 'out', 'apk-dir-diff.ppk');

    await createZip(originPath, {
      'assets/index.android.bundle': 'old-bundle',
    });
    await createZip(nextPath, {
      'index.bundlejs': 'new-bundle',
      'assets/': '',
      'assets/new.txt': 'new-file',
    });

    await diffCommands.diffFromApk(
      createContext([originPath, nextPath], {
        output: outputPath,
        customDiff: (oldSource, newSource) =>
          Buffer.from(
            `patch:${oldSource?.toString('utf-8')}:${newSource?.toString('utf-8')}`,
          ),
      }),
    );

    const result = await readZipContent(outputPath);
    expect(result.entries).toContain('assets/');
    expect(result.files['assets/new.txt']?.toString('utf-8')).toBe('new-file');
  });

  test('diffFromIpa ignores non-payload files when resolving origin package path', async () => {
    const originPath = path.join(tempRoot, 'origin-non-payload.ipa');
    const nextPath = path.join(tempRoot, 'next-non-payload.ppk');
    const outputPath = path.join(tempRoot, 'out', 'non-payload-diff.ppk');

    await createZip(originPath, {
      'Random/ignored.txt': 'ignored',
      'Payload/MyApp.app/main.jsbundle': 'old-bundle',
      'Payload/MyApp.app/assets/icon.png': 'same-icon',
    });
    await createZip(nextPath, {
      'index.bundlejs': 'new-bundle',
      'assets/icon.png': 'same-icon',
    });

    await diffCommands.diffFromIpa(
      createContext([originPath, nextPath], {
        output: outputPath,
        customDiff: () => Buffer.from('patch'),
      }),
    );

    const result = await readZipContent(outputPath);
    const diffMeta = JSON.parse(
      result.files['__diff.json'].toString('utf-8'),
    ) as {
      copies: Record<string, string>;
    };
    expect(diffMeta.copies['assets/icon.png']).toBe('');
  });

  test('diff throws when output option is not string', async () => {
    await expect(
      diffCommands.diff(
        createContext(['origin.ppk', 'next.ppk'], {
          output: 123,
          customDiff: () => Buffer.from('patch'),
        }),
      ),
    ).rejects.toThrow('Output path is required.');
  });

  test('hdiff/diff require engine modules when customDiff is not provided', async () => {
    const hasHdiff = hasDiffModule('node-hdiffpatch');
    const hasBsdiff = hasDiffModule('node-bsdiff');

    if (!hasHdiff) {
      await expect(
        diffCommands.hdiff(
          createContext(['origin.ppk', 'next.ppk'], {
            output: path.join(tempRoot, 'out', 'hdiff.ppk'),
          }),
        ),
      ).rejects.toThrow(/node-hdiffpatch/);
    }

    if (!hasBsdiff) {
      await expect(
        diffCommands.diff(
          createContext(['origin.ppk', 'next.ppk'], {
            output: path.join(tempRoot, 'out', 'diff.ppk'),
          }),
        ),
      ).rejects.toThrow(/node-bsdiff/);
    }

    expect(true).toBe(true);
  });
});
