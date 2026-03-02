import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ZipFile as YazlZipFile } from 'yazl';
import { diffCommands, enumZipEntries, readEntry } from '../src/diff';
import type { CommandContext } from '../src/types';

type ZipContent = {
  entries: string[];
  files: Record<string, Buffer>;
};

type DiffContextOptions = {
  output: string;
  customDiff: (oldSource?: Buffer, newSource?: Buffer) => Buffer;
};

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
  };

  await enumZipEntries(zipPath, async (entry, zipFile) => {
    content.entries.push(entry.fileName);
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
    expect(result.files['assets/same.txt']).toBeUndefined();
    expect(result.files['moved/newdir/moved-source.txt']).toBeUndefined();
    expect(result.entries).toContain('moved/');
    expect(result.entries).toContain('moved/newdir/');

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
});
