import { ResourceFinder } from './resource-finder';
import { parseBinaryXml, type XmlElement } from './xml-parser/binary';

export interface ApkManifestInfo {
  versionName?: unknown;
  /** `<application>`'s `<meta-data>` entries, resource references resolved */
  metaData: Array<{ name?: unknown; value?: unknown }>;
}

/**
 * The fields of a binary AndroidManifest.xml the CLI reads, with
 * `@<resource>` references resolved through resources.arsc when given.
 */
export function parseApkManifest(
  manifest: Buffer,
  resources?: Buffer,
): ApkManifestInfo {
  let root: XmlElement;
  try {
    root = parseBinaryXml(manifest);
  } catch (e: any) {
    throw new Error(`Parse AndroidManifest.xml error: ${e.message || e}`);
  }
  let resourceMap: Record<string, unknown> = {};
  if (resources) {
    try {
      resourceMap = new ResourceFinder().processResourceTable(resources);
    } catch (e: any) {
      throw new Error(`Parser resources.arsc error: ${e}`);
    }
  }
  const resolve = (value: unknown) =>
    typeof value === 'string' && value.startsWith('resourceId:')
      ? resourceMap[`@${value.replace('resourceId:0x', '').toUpperCase()}`]
      : value;

  const application = root.children.find((el) => el.name === 'application');
  return {
    versionName: resolve(root.attributes.versionName),
    metaData: (application?.children ?? [])
      .filter((el) => el.name === 'meta-data')
      .map(({ attributes }) => ({
        name: resolve(attributes.name),
        value: resolve(attributes.value),
      })),
  };
}
