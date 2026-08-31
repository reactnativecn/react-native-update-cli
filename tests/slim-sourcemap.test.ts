import { describe, expect, test } from 'bun:test';
import { slimSourceMap } from '../src/utils/slim-sourcemap';

const root = '/work/app';

describe('slimSourceMap', () => {
  test('relativizes project paths and drops dependency sourcesContent only', () => {
    const slimmed = slimSourceMap(
      JSON.stringify({
        version: 3,
        sources: [
          '/work/app/src/index.tsx',
          '/work/app/node_modules/react-native/index.js',
          '/other/place/file.js',
        ],
        sourcesContent: ['app code', 'dependency code', 'external code'],
        names: ['fn'],
        mappings: 'AAAA',
      }),
      root,
    );
    expect(slimmed).not.toBeNull();
    const map = JSON.parse(slimmed!);
    expect(map.sources).toEqual([
      'src/index.tsx',
      'node_modules/react-native/index.js',
      '/other/place/file.js',
    ]);
    // App code keeps its snippet source; dependency content is dropped while
    // its path stays mappable. Paths outside the project keep content: they
    // are not resolvable from the repository later.
    expect(map.sourcesContent).toEqual(['app code', null, 'external code']);
    expect(map.names).toEqual(['fn']);
    expect(map.mappings).toBe('AAAA');
  });

  test('strips content of nested and already-relative node_modules sources', () => {
    const slimmed = slimSourceMap(
      JSON.stringify({
        version: 3,
        sources: [
          'node_modules/lib/a.js',
          '/work/app/packages/ui/node_modules/lib/b.js',
        ],
        sourcesContent: ['a', 'b'],
        mappings: 'AAAA',
      }),
      root,
    );
    const map = JSON.parse(slimmed!);
    expect(map.sourcesContent).toEqual([null, null]);
  });

  test('keeps maps without sourcesContent intact', () => {
    const slimmed = slimSourceMap(
      JSON.stringify({
        version: 3,
        sources: ['/work/app/src/a.ts'],
        mappings: 'AAAA',
      }),
      root,
    );
    expect(JSON.parse(slimmed!).sources).toEqual(['src/a.ts']);
  });

  test('refuses invalid JSON, indexed maps, and shapeless input', () => {
    expect(slimSourceMap('not json', root)).toBeNull();
    expect(
      slimSourceMap(JSON.stringify({ version: 3, sections: [] }), root),
    ).toBeNull();
    expect(slimSourceMap(JSON.stringify({ version: 3 }), root)).toBeNull();
    expect(slimSourceMap(JSON.stringify([1, 2]), root)).toBeNull();
  });
});
