import { enumZipEntries, readEntry } from '../zip-entries';

/**
 * Read the entries matching each pattern in a single pass over the archive
 * (nested .hap archives included). Each entry name is tried as-is and
 * lowercased, with NUL padding stripped. Returns buffers in pattern order.
 */
export async function readZipEntries(
  file: string,
  patterns: RegExp[],
): Promise<(Buffer | undefined)[]> {
  const results: (Buffer | undefined)[] = new Array(patterns.length);
  await enumZipEntries(file, async (entry, zipFile) => {
    if (entry.fileName.endsWith('/')) {
      return;
    }
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips NUL padding from entry names
    const name = entry.fileName.replace(/\u0000/g, '');
    const lowerName = name.toLowerCase();
    const index = patterns.findIndex(
      (pattern) => pattern.test(name) || pattern.test(lowerName),
    );
    if (index !== -1) {
      results[index] = await readEntry(entry, zipFile);
    }
  });
  return results;
}
