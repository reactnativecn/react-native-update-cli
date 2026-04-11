import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { translateOptions } from '../src/utils';
import {
  zipOptionsForManifestEntry,
  zipOptionsForPatchEntry,
  zipOptionsForPayloadEntry,
} from '../src/utils/zip-options';

describe('translateOptions', () => {
  test('replaces template variables from options', () => {
    const options = {
      platform: 'ios',
      output: '${tempDir}/output/${platform}.ppk',
      tempDir: '/tmp/test',
    };
    const result = translateOptions(options);
    expect(result.output).toBe('/tmp/test/output/ios.ppk');
  });

  test('falls back to environment variables', () => {
    process.env.TEST_TRANSLATE_VAR = 'env-value';
    const options = {
      output: '${TEST_TRANSLATE_VAR}/file.ppk',
    };
    const result = translateOptions(options);
    expect(result.output).toBe('env-value/file.ppk');
    delete process.env.TEST_TRANSLATE_VAR;
  });

  test('leaves unresolvable placeholders as-is', () => {
    const options = {
      output: '${NONEXISTENT_VAR}/file.ppk',
    };
    const result = translateOptions(options);
    expect(result.output).toBe('${NONEXISTENT_VAR}/file.ppk');
  });

  test('passes non-string values through unchanged', () => {
    const options = {
      count: 42,
      flag: true,
      nested: { key: 'value' },
    };
    const result = translateOptions(options);
    expect(result.count).toBe(42);
    expect(result.flag).toBe(true);
    expect(result.nested).toEqual({ key: 'value' });
  });

  test('replaces multiple placeholders in one string', () => {
    const options = {
      platform: 'android',
      time: '12345',
      output: '${platform}-${time}.ppk',
    };
    const result = translateOptions(options);
    expect(result.output).toBe('android-12345.ppk');
  });

  test('handles numeric option values in template', () => {
    const options = {
      version: 42,
      output: 'v${version}.ppk',
    };
    const result = translateOptions(options);
    expect(result.output).toBe('v42.ppk');
  });
});

describe('zipOptionsForPatchEntry', () => {
  test('returns compress false', () => {
    expect(zipOptionsForPatchEntry()).toEqual({ compress: false });
  });
});

describe('zipOptionsForManifestEntry', () => {
  test('returns compress false', () => {
    expect(zipOptionsForManifestEntry()).toEqual({ compress: false });
  });
});

describe('zipOptionsForPayloadEntry', () => {
  test('compresses regular files with level 9', () => {
    const result = zipOptionsForPayloadEntry('bundle.js');
    expect(result).toEqual({ compress: true, compressionLevel: 9 });
  });

  test('skips compression for PNG files', () => {
    const result = zipOptionsForPayloadEntry('icon.png');
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for JPEG files', () => {
    expect(zipOptionsForPayloadEntry('photo.jpg')).toEqual({
      compress: false,
    });
    expect(zipOptionsForPayloadEntry('photo.jpeg')).toEqual({
      compress: false,
    });
  });

  test('skips compression for already-compressed extensions', () => {
    const compressed = [
      'archive.zip',
      'data.gz',
      'app.apk',
      'font.woff2',
      'video.mp4',
    ];
    for (const name of compressed) {
      expect(zipOptionsForPayloadEntry(name)).toEqual({ compress: false });
    }
  });

  test('compresses text-like files', () => {
    const textFiles = ['data.json', 'styles.css', 'readme.txt', 'index.html'];
    for (const name of textFiles) {
      expect(zipOptionsForPayloadEntry(name)).toEqual({
        compress: true,
        compressionLevel: 9,
      });
    }
  });

  test('detects Hermes bytecode magic and compresses it', () => {
    // Hermes bytecode magic: c6 1f bc 03 c1 03 19 1f
    const hermesMagic = Buffer.from([
      0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f, 0x00, 0x00,
    ]);
    const result = zipOptionsForPayloadEntry('index.bundlejs', hermesMagic);
    expect(result).toEqual({ compress: true, compressionLevel: 9 });
  });

  test('skips compression for PNG magic bytes', () => {
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const result = zipOptionsForPayloadEntry('unknown_file', pngMagic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for JPEG magic bytes', () => {
    const jpegMagic = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    const result = zipOptionsForPayloadEntry('unknown_file', jpegMagic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for GIF87a magic', () => {
    const gifMagic = Buffer.from('GIF87a', 'ascii');
    const result = zipOptionsForPayloadEntry('unknown_file', gifMagic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for GIF89a magic', () => {
    const gifMagic = Buffer.from('GIF89a', 'ascii');
    const result = zipOptionsForPayloadEntry('unknown_file', gifMagic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for ZIP magic bytes', () => {
    const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    const result = zipOptionsForPayloadEntry('unknown_file', zipMagic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for gzip magic bytes', () => {
    const gzMagic = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00]);
    const result = zipOptionsForPayloadEntry('unknown_file', gzMagic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for WEBP magic sequence', () => {
    // RIFF....WEBP
    const webpMagic = Buffer.alloc(12);
    webpMagic.write('RIFF', 0, 'ascii');
    webpMagic.writeUInt32LE(1234, 4); // file size
    webpMagic.write('WEBP', 8, 'ascii');
    const result = zipOptionsForPayloadEntry('unknown_file', webpMagic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for BZh (bzip2) magic', () => {
    const bz2Magic = Buffer.from('BZh91AY&SY', 'ascii');
    const result = zipOptionsForPayloadEntry('unknown_file', bz2Magic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for xz magic', () => {
    const xzMagic = Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
    const result = zipOptionsForPayloadEntry('unknown_file', xzMagic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for 7z magic', () => {
    const sevenZMagic = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
    const result = zipOptionsForPayloadEntry('unknown_file', sevenZMagic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for zstd magic', () => {
    const zstdMagic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00]);
    const result = zipOptionsForPayloadEntry('unknown_file', zstdMagic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for MP4 ftyp magic', () => {
    const mp4Magic = Buffer.alloc(12);
    mp4Magic.writeUInt32BE(20, 0); // box size
    mp4Magic.write('ftyp', 4, 'ascii');
    mp4Magic.write('isom', 8, 'ascii');
    const result = zipOptionsForPayloadEntry('unknown_file', mp4Magic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for Ogg magic', () => {
    const oggMagic = Buffer.from('OggS\x00\x02', 'ascii');
    const result = zipOptionsForPayloadEntry('unknown_file', oggMagic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for ID3 (MP3) magic', () => {
    const id3Magic = Buffer.from('ID3\x04\x00', 'ascii');
    const result = zipOptionsForPayloadEntry('unknown_file', id3Magic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for wOFF magic', () => {
    const woffMagic = Buffer.from('wOFF\x00', 'ascii');
    const result = zipOptionsForPayloadEntry('unknown_file', woffMagic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for wOF2 magic', () => {
    const wof2Magic = Buffer.from('wOF2\x00', 'ascii');
    const result = zipOptionsForPayloadEntry('unknown_file', wof2Magic);
    expect(result).toEqual({ compress: false });
  });

  test('skips compression for Hermes delta bytecode magic', () => {
    const hermesDeltaMagic = Buffer.from([
      0x39, 0xe0, 0x43, 0xfc, 0x3e, 0xfc, 0xe6, 0xe0, 0x00, 0x00,
    ]);
    const result = zipOptionsForPayloadEntry(
      'index.bundlejs',
      hermesDeltaMagic,
    );
    expect(result).toEqual({ compress: true, compressionLevel: 9 });
  });

  test('falls back to extension check when prefix is empty', () => {
    const emptyPrefix = Buffer.alloc(0);
    expect(zipOptionsForPayloadEntry('bundle.js', emptyPrefix)).toEqual({
      compress: true,
      compressionLevel: 9,
    });
    expect(zipOptionsForPayloadEntry('image.png', emptyPrefix)).toEqual({
      compress: false,
    });
  });

  test('compresses unknown binary without recognized magic', () => {
    const randomBytes = Buffer.from([
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    ]);
    const result = zipOptionsForPayloadEntry('unknown_file', randomBytes);
    expect(result).toEqual({ compress: true, compressionLevel: 9 });
  });

  test('skips compression for MPEG audio frame sync', () => {
    // 0xff with (byte & 0xe0) === 0xe0
    const mp3Frame = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
    const result = zipOptionsForPayloadEntry('unknown_file', mp3Frame);
    expect(result).toEqual({ compress: false });
  });
});
