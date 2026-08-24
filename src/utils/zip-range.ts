// Byte-range access to zip archives.
//
// Two halves of the same trick: at publish time `locateZipEntry` records where
// the bundle's compressed bytes sit inside the ppk (so the server can hand
// that location to the next build), and at build time `fetchZipEntryData` /
// `openRemoteZip` read just the bundle of a remote archive through HTTP Range
// requests instead of downloading the whole ppk / apk / ipa. Every helper
// throws on anything unexpected; callers fall back to a full download.
import fs from 'fs-extra';
import { PassThrough, Readable } from 'stream';
import {
  type Entry,
  fromRandomAccessReader,
  open as openZipFile,
  RandomAccessReader,
  type ZipFile,
} from 'yauzl';
import { inflateRawSync } from 'zlib';
import { readEntry } from './zip-entries';

export const ZIP_STORED = 0;
export const ZIP_DEFLATED = 8;

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;
/** covers the EOCD (≤ 22 + 65535 bytes) and, for small archives, everything */
const TAIL_BYTES = 64 * 1024;
/** minimum span fetched for header reads, so header + directory share a request */
const CHUNK_BYTES = 64 * 1024;

export interface ZipEntryLocation {
  fileName: string;
  /** absolute offset of the compressed data, past the local file header */
  dataOffset: number;
  compressedSize: number;
  uncompressedSize: number;
  /** 0 = stored, 8 = deflate; anything else cannot be inflated here */
  compressionMethod: number;
}

/** Data location of the first entry matching `matches` in a local zip. */
export async function locateZipEntry(
  zipPath: string,
  matches: (name: string) => boolean,
): Promise<ZipEntryLocation | null> {
  const entry = await findEntry(zipPath, matches);
  if (!entry) return null;
  const header = Buffer.alloc(LOCAL_HEADER_SIZE);
  const fd = await fs.open(zipPath, 'r');
  try {
    const { bytesRead } = await fs.read(
      fd,
      header,
      0,
      LOCAL_HEADER_SIZE,
      entry.relativeOffsetOfLocalHeader,
    );
    if (bytesRead !== LOCAL_HEADER_SIZE) {
      throw new Error('truncated local file header');
    }
  } finally {
    await fs.close(fd);
  }
  if (header.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error('invalid local file header signature');
  }
  const fileNameLength = header.readUInt16LE(26);
  const extraFieldLength = header.readUInt16LE(28);
  return {
    fileName: entry.fileName,
    dataOffset:
      entry.relativeOffsetOfLocalHeader +
      LOCAL_HEADER_SIZE +
      fileNameLength +
      extraFieldLength,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
    compressionMethod: entry.compressionMethod,
  };
}

function findEntry(
  zipPath: string,
  matches: (name: string) => boolean,
): Promise<Entry | null> {
  return new Promise((resolve, reject) => {
    openZipFile(zipPath, { lazyEntries: true }, (err, zipFile) => {
      if (err) return reject(err);
      let found: Entry | null = null;
      zipFile.on('error', reject);
      zipFile.on('end', () => resolve(found));
      zipFile.on('entry', (entry: Entry) => {
        if (!found && matches(entry.fileName)) {
          found = entry;
          zipFile.close();
          resolve(found);
          return;
        }
        zipFile.readEntry();
      });
      zipFile.readEntry();
    });
  });
}

// ---------------------------------------------------------------------------
// HTTP Range
// ---------------------------------------------------------------------------

/** The server answered a Range request with the whole body (HTTP 200). */
export class RangeUnsupportedError extends Error {
  constructor(readonly response: Response) {
    super(`HTTP ${response.status} without Content-Range`);
    this.name = 'RangeUnsupportedError';
  }
}

interface ContentRange {
  start: number;
  end: number;
  total: number;
}

export function parseContentRange(header: string | null): ContentRange | null {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(header?.trim() ?? '');
  if (!match) return null;
  const [start, end, total] = match.slice(1).map(Number);
  if (end < start || end >= total) return null;
  return { start, end, total };
}

/** One Range request; `end` is exclusive. Resolves with a 206 response. */
async function fetchRange(
  url: string,
  start: number,
  end: number,
): Promise<Response & { range: ContentRange }> {
  const response = await fetch(url, {
    headers: {
      Range: `bytes=${start}-${end - 1}`,
      'Accept-Encoding': 'identity',
    },
  });
  if (response.status === 200) throw new RangeUnsupportedError(response);
  if (response.status !== 206 || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${response.status} for bytes=${start}-${end - 1}`);
  }
  const range = parseContentRange(response.headers.get('content-range'));
  if (!range || range.start !== start || range.end !== end - 1) {
    await response.body.cancel().catch(() => {});
    throw new Error(
      `unexpected Content-Range ${response.headers.get('content-range')}`,
    );
  }
  return Object.assign(response, { range });
}

async function fetchRangeBuffer(
  url: string,
  start: number,
  end: number,
): Promise<{ data: Buffer; total: number }> {
  const response = await fetchRange(url, start, end);
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length !== end - start) {
    throw new Error(
      `range returned ${data.length} bytes, expected ${end - start}`,
    );
  }
  return { data, total: response.range.total };
}

/**
 * Fetch one entry whose compressed bytes are already located (the ppk's own
 * publish-time report) and decompress it. Returns the raw entry content.
 */
export async function fetchZipEntryData(
  url: string,
  location: Pick<
    ZipEntryLocation,
    'dataOffset' | 'compressedSize' | 'compressionMethod'
  >,
): Promise<{ data: Buffer; fetchedBytes: number; totalBytes: number }> {
  const { dataOffset, compressedSize, compressionMethod } = location;
  if (compressionMethod !== ZIP_STORED && compressionMethod !== ZIP_DEFLATED) {
    throw new Error(`unsupported compression method ${compressionMethod}`);
  }
  if (
    !Number.isInteger(dataOffset) ||
    !Number.isInteger(compressedSize) ||
    dataOffset < 0 ||
    compressedSize <= 0
  ) {
    throw new Error('invalid bundle location');
  }
  const { data, total } = await fetchRangeBuffer(
    url,
    dataOffset,
    dataOffset + compressedSize,
  );
  return {
    data: compressionMethod === ZIP_DEFLATED ? inflateRawSync(data) : data,
    fetchedBytes: compressedSize,
    totalBytes: total,
  };
}

/**
 * yauzl reader over HTTP Range. Header reads (EOCD, central directory, local
 * file headers) are widened to CHUNK_BYTES and cached so a small archive costs
 * one request; entry data streams straight from its own request.
 */
export class HttpRangeReader extends RandomAccessReader {
  private readonly chunks: { start: number; data: Buffer }[] = [];
  requests = 0;
  fetchedBytes = 0;

  constructor(
    private readonly url: string,
    readonly totalSize: number,
    tail?: { start: number; data: Buffer },
  ) {
    super();
    if (tail) this.chunks.push(tail);
  }

  private cached(start: number, end: number): Buffer | null {
    for (const chunk of this.chunks) {
      if (start >= chunk.start && end <= chunk.start + chunk.data.length) {
        return chunk.data.subarray(start - chunk.start, end - chunk.start);
      }
    }
    return null;
  }

  _readStreamForRange(start: number, end: number): Readable {
    const hit = this.cached(start, end);
    if (hit) return Readable.from([hit]);
    const out = new PassThrough();
    this.requests++;
    fetchRange(this.url, start, end)
      .then((response) => {
        this.fetchedBytes += end - start;
        const body = Readable.fromWeb(response.body as any);
        body.on('error', (error) => out.destroy(error));
        body.pipe(out);
      })
      .catch((error) => out.destroy(error));
    return out;
  }

  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error | null, bytesRead?: number) => void,
  ): void {
    const hit = this.cached(position, position + length);
    if (hit) {
      hit.copy(buffer, offset);
      setImmediate(() => callback(null, length));
      return;
    }
    const end = Math.min(
      this.totalSize,
      Math.max(position + length, position + CHUNK_BYTES),
    );
    this.requests++;
    fetchRangeBuffer(this.url, position, end).then(
      ({ data }) => {
        this.fetchedBytes += data.length;
        this.chunks.push({ start: position, data });
        data.copy(buffer, offset, 0, length);
        callback(null, length);
      },
      (error) => callback(error),
    );
  }
}

export type RemoteZip =
  | { kind: 'zip'; zipFile: ZipFile; reader: HttpRangeReader }
  /** the server ignored Range: the whole archive is streaming in `response` */
  | { kind: 'full'; response: Response };

/**
 * Open a remote zip by fetching its tail (EOCD + central directory for
 * typical archives) and letting yauzl read the rest on demand.
 */
export async function openRemoteZip(url: string): Promise<RemoteZip> {
  const response = await fetch(url, {
    headers: { Range: `bytes=-${TAIL_BYTES}`, 'Accept-Encoding': 'identity' },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`HTTP ${response.status}`);
  }
  if (response.status !== 206) return { kind: 'full', response };
  const range = parseContentRange(response.headers.get('content-range'));
  if (!range) {
    await response.body.cancel().catch(() => {});
    throw new Error(
      `unexpected Content-Range ${response.headers.get('content-range')}`,
    );
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (data.length !== range.end - range.start + 1) {
    throw new Error(
      `tail returned ${data.length} bytes, expected ${range.end - range.start + 1}`,
    );
  }
  const reader = new HttpRangeReader(url, range.total, {
    start: range.start,
    data,
  });
  reader.requests = 1;
  reader.fetchedBytes = data.length;
  const zipFile = await new Promise<ZipFile>((resolve, reject) => {
    fromRandomAccessReader(
      reader,
      range.total,
      { lazyEntries: true, autoClose: false },
      (err, file) => (err ? reject(err) : resolve(file)),
    );
  });
  return { kind: 'zip', zipFile, reader };
}

/** Read the first matching entry of an opened remote zip, then close it. */
export function readRemoteZipEntry(
  zipFile: ZipFile,
  matches: (name: string) => boolean,
): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error: Error | null, result: Buffer | null = null) => {
      if (settled) return;
      settled = true;
      zipFile.close();
      error ? reject(error) : resolve(result);
    };
    zipFile.on('error', (error) => finish(error));
    zipFile.on('end', () => finish(null, null));
    zipFile.on('entry', (entry: Entry) => {
      if (!matches(entry.fileName)) {
        zipFile.readEntry();
        return;
      }
      readEntry(entry, zipFile).then(
        (data) => finish(null, data),
        (error) => finish(error),
      );
    });
    zipFile.readEntry();
  });
}
