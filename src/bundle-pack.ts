import path from 'path';
import * as fs from 'fs-extra';
import { ZipFile as YazlZipFile } from 'yazl';
import { t } from './utils/i18n';
import { zipOptionsForPayloadFile } from './utils/zip-options';

const ignorePackingFileNames = [
  '.',
  '..',
  'index.bundlejs.map',
  'bundle.harmony.js.map',
];
const ignorePackingExtensions = ['DS_Store', 'txt.map'];

export async function packBundle(dir: string, output: string): Promise<void> {
  console.log(t('packing'));
  fs.ensureDirSync(path.dirname(output));
  await new Promise<void>((resolve, reject) => {
    const zipfile = new YazlZipFile();

    function addDirectory(root: string, rel: string) {
      if (rel) {
        zipfile.addEmptyDirectory(rel);
      }
      const children = fs.readdirSync(root);
      for (const name of children) {
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

    addDirectory(dir, '');

    zipfile.outputStream.on('error', (err: unknown) => reject(err));
    zipfile.outputStream.pipe(fs.createWriteStream(output)).on('close', () => {
      resolve();
    });
    zipfile.end();
  });
  console.log(t('fileGenerated', { file: output }));
}
