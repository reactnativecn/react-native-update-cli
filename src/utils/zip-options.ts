import path from 'path';
import * as fs from 'fs';

export type ZipEntryOptions = {
  compress?: boolean;
  compressionLevel?: number;
};

export const ZIP_ENTRY_SNIFF_BYTES = 64;

const alreadyCompressedExtensions = new Set([
  '.7z',
  '.aab',
  '.apk',
  '.br',
  '.bz2',
  '.gif',
  '.gz',
  '.heic',
  '.jpeg',
  '.jpg',
  '.lzma',
  '.mp3',
  '.mp4',
  '.ogg',
  '.png',
  '.webm',
  '.webp',
  '.woff',
  '.woff2',
  '.xz',
  '.zip',
  '.zst',
]);

const HERMES_MAGIC = Buffer.from([
  0xc6, 0x1f, 0xbc, 0x03, 0xc1, 0x03, 0x19, 0x1f,
]);
const HERMES_DELTA_MAGIC = Buffer.from([
  0x39, 0xe0, 0x43, 0xfc, 0x3e, 0xfc, 0xe6, 0xe0,
]);

function startsWith(bytes: Buffer, signature: Buffer): boolean {
  return (
    bytes.length >= signature.length &&
    bytes.subarray(0, signature.length).equals(signature)
  );
}

function hasHermesBytecodeMagic(bytes: Buffer): boolean {
  return (
    startsWith(bytes, HERMES_MAGIC) || startsWith(bytes, HERMES_DELTA_MAGIC)
  );
}

function hasAlreadyCompressedMagic(bytes: Buffer): boolean {
  if (bytes.length < 2) {
    return false;
  }

  if (startsWith(bytes, Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    return true;
  }
  if (startsWith(bytes, Buffer.from([0xff, 0xd8, 0xff]))) {
    return true;
  }
  if (
    startsWith(bytes, Buffer.from('GIF87a', 'ascii')) ||
    startsWith(bytes, Buffer.from('GIF89a', 'ascii'))
  ) {
    return true;
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).equals(Buffer.from('RIFF', 'ascii')) &&
    bytes.subarray(8, 12).equals(Buffer.from('WEBP', 'ascii'))
  ) {
    return true;
  }
  if (
    startsWith(bytes, Buffer.from([0x50, 0x4b, 0x03, 0x04])) ||
    startsWith(bytes, Buffer.from([0x50, 0x4b, 0x05, 0x06])) ||
    startsWith(bytes, Buffer.from([0x50, 0x4b, 0x07, 0x08]))
  ) {
    return true;
  }
  if (startsWith(bytes, Buffer.from([0x1f, 0x8b]))) {
    return true;
  }
  if (startsWith(bytes, Buffer.from('BZh', 'ascii'))) {
    return true;
  }
  if (startsWith(bytes, Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]))) {
    return true;
  }
  if (startsWith(bytes, Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]))) {
    return true;
  }
  if (startsWith(bytes, Buffer.from([0x28, 0xb5, 0x2f, 0xfd]))) {
    return true;
  }
  if (bytes.length >= 12 && bytes.subarray(4, 8).equals(Buffer.from('ftyp'))) {
    return true;
  }
  if (startsWith(bytes, Buffer.from('OggS', 'ascii'))) {
    return true;
  }
  if (startsWith(bytes, Buffer.from('ID3', 'ascii'))) {
    return true;
  }
  if (
    bytes[0] === 0xff &&
    bytes.length >= 2 &&
    (bytes[1] & 0xe0) === 0xe0
  ) {
    return true;
  }
  if (
    startsWith(bytes, Buffer.from('wOFF', 'ascii')) ||
    startsWith(bytes, Buffer.from('wOF2', 'ascii'))
  ) {
    return true;
  }

  return false;
}

function readFilePrefix(filePath: string): Buffer {
  const buffer = Buffer.alloc(ZIP_ENTRY_SNIFF_BYTES);
  const fd = fs.openSync(filePath, 'r');
  try {
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

export function zipOptionsForPatchEntry(): ZipEntryOptions {
  return { compress: false };
}

export function zipOptionsForManifestEntry(): ZipEntryOptions {
  return { compress: false };
}

export function zipOptionsForPayloadEntry(
  fileName: string,
  prefix?: Buffer,
): ZipEntryOptions {
  if (prefix && prefix.length > 0) {
    if (hasHermesBytecodeMagic(prefix)) {
      // Hermes bytecode is binary, but still benefits significantly from zip deflate.
      return { compress: true, compressionLevel: 9 };
    }
    if (hasAlreadyCompressedMagic(prefix)) {
      return { compress: false };
    }
  }

  const extension = path.extname(fileName).toLowerCase();
  if (alreadyCompressedExtensions.has(extension)) {
    return { compress: false };
  }
  return { compress: true, compressionLevel: 9 };
}

export function zipOptionsForPayloadFile(
  filePath: string,
  entryName = filePath,
): ZipEntryOptions {
  return zipOptionsForPayloadEntry(entryName, readFilePrefix(filePath));
}
