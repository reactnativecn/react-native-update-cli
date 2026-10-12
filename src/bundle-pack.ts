import fs from 'fs';
import path from 'path';
import { t } from './utils/i18n';
import { createOutputZip } from './utils/zip-entries';
import { zipOptionsForPayloadFile } from './utils/zip-options';

const ignorePackingExtensions = ['DS_Store', 'txt.map'];

export async function packBundle(
  dir: string,
  output: string,
  bundleName?: string,
): Promise<void> {
  const ignorePackingFileNames = [
    'index.bundlejs.map',
    'bundle.harmony.js.map',
  ];
  if (bundleName) {
    ignorePackingFileNames.push(`${bundleName}.map`);
  }
  console.log(t('packing'));
  const { zipfile, writePromise, abort } = createOutputZip(output);

  function addDirectory(root: string, rel: string) {
    if (rel) {
      zipfile.addEmptyDirectory(rel);
    }
    for (const name of fs.readdirSync(root)) {
      if (
        ignorePackingFileNames.includes(name) ||
        ignorePackingExtensions.some((ext) => name.endsWith(`.${ext}`))
      ) {
        continue;
      }
      const fullPath = path.join(root, name);
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        zipfile.addFile(
          fullPath,
          rel + name,
          zipOptionsForPayloadFile(fullPath, rel + name),
        );
      } else if (stat.isDirectory()) {
        addDirectory(fullPath, `${rel}${name}/`);
      }
    }
  }

  try {
    addDirectory(dir, '');
    zipfile.end();
    await writePromise;
  } catch (error) {
    await abort();
    throw error;
  }
  console.log(t('fileGenerated', { file: output }));
}
