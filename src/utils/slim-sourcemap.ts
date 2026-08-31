import path from 'path';

interface SourceMapV3 {
  sources?: unknown;
  sourcesContent?: unknown;
  sections?: unknown;
  [key: string]: unknown;
}

/**
 * Shrink a source map before archiving it with a version, without losing the
 * ability to locate any frame:
 *
 * - absolute source paths under the project root become relative (build
 *   machine paths do not belong in an uploaded artifact);
 * - `sourcesContent` of node_modules sources is dropped. Mappings and the
 *   source paths stay, so frames inside dependencies still symbolicate to
 *   `node_modules/...:line:column` — only the inline code snippet for those
 *   frames is lost, and dependency sources are recoverable from the lockfile
 *   anyway. On an RN app this is the bulk of the map's bytes.
 *
 * Returns null when the content is not a usable plain source map (invalid
 * JSON, or an indexed map with `sections`); the caller then uploads the
 * original file untouched.
 */
export function slimSourceMap(
  content: string,
  projectRoot: string,
): string | null {
  let map: SourceMapV3;
  try {
    map = JSON.parse(content) as SourceMapV3;
  } catch {
    return null;
  }
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return null;
  }
  if (map.sections !== undefined) {
    return null;
  }
  if (!Array.isArray(map.sources)) {
    return null;
  }
  const rootPrefix = normalizeSlashes(path.resolve(projectRoot));
  const sources = (map.sources as unknown[]).map((source) =>
    typeof source === 'string' ? relativizeSource(source, rootPrefix) : source,
  );
  map.sources = sources;
  if (Array.isArray(map.sourcesContent)) {
    map.sourcesContent = (map.sourcesContent as unknown[]).map(
      (item, index) => {
        const source = sources[index];
        if (typeof source === 'string' && isDependencySource(source)) {
          return null;
        }
        return item;
      },
    );
  }
  return JSON.stringify(map);
}

function normalizeSlashes(value: string): string {
  return value.replace(/\\/g, '/');
}

function relativizeSource(source: string, rootPrefix: string): string {
  const normalized = normalizeSlashes(source);
  if (normalized === rootPrefix) {
    return '';
  }
  if (normalized.startsWith(`${rootPrefix}/`)) {
    return normalized.slice(rootPrefix.length + 1);
  }
  return normalized;
}

function isDependencySource(source: string): boolean {
  return (
    source.startsWith('node_modules/') || source.includes('/node_modules/')
  );
}
