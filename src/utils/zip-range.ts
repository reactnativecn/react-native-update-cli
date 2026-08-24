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
/**
 * Exactly what yauzl reads to find the EOCD (22 + 65535 comment + 20 zip64
 * locator), so its first read is a cache hit; small archives fit entirely.
 */
const TAIL_BYTES = 22 + 0xffff + 20;
/** minimum span fetched for header reads, so header + directory share a request */
const CHUNK_BYTES = 64 * 1024;
/** extra bytes past a hinted entry, covering a longer local extra field */
const HINT_SLACK_BYTES = 4 * 1024;

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
  const found = await openFirstEntry(zipPath, matches);
  if (!found) return null;
  found.zipFile.close();
  return locationOfEntry(zipPath, found.entry);
}

/**
 * Content and data location of the first matching entry in one pass over the
 * archive (publish needs both: the bundle to hash and cache, its location to
 * report to the server).
 */
export async function readZipEntryWithLocation(
  zipPath: string,
  matches: (name: string) => boolean,
): Promise<{ data: Buffer; location: ZipEntryLocation } | null> {
  const found = await openFirstEntry(zipPath, matches);
  if (!found) return null;
  let data: Buffer;
  try {
    data = await readEntry(found.entry, found.zipFile);
  } finally {
    found.zipFile.close();
  }
  return { data, location: await locationOfEntry(zipPath, found.entry) };
}

async function locationOfEntry(
  zipPath: string,
  entry: Entry,
): Promise<ZipEntryLocation> {
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

/** Open a local zip and stop at the first matching entry (caller closes). */
function openFirstEntry(
  zipPath: string,
  matches: (name: string) => boolean,
): Promise<{ zipFile: ZipFile; entry: Entry } | null> {
  return new Promise((resolve, reject) => {
    openZipFile(
      zipPath,
      { lazyEntries: true, autoClose: false },
      (err, zipFile) => {
        if (err) return reject(err);
        let settled = false;
        zipFile.on('error', (error) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
        zipFile.on('end', () => {
          if (!settled) {
            settled = true;
            zipFile.close();
            resolve(null);
          }
        });
        zipFile.on('entry', (entry: Entry) => {
          if (settled) return;
          if (matches(entry.fileName)) {
            settled = true;
            resolve({ zipFile, entry });
            return;
          }
          zipFile.readEntry();
        });
        zipFile.readEntry();
      },
    );
  });
}

/**
 * The `bundleOffset` / `bundleCompressedSize` / `bundleCompression` fields for
 * version/create and package/create, or nothing when the entry cannot be
 * fetched by a single Range request (unknown, empty or exotic compression).
 */
export function bundleLocationFields(
  location: ZipEntryLocation | null | undefined,
): Record<string, number> {
  if (
    !location ||
    location.compressedSize <= 0 ||
    (location.compressionMethod !== ZIP_STORED &&
      location.compressionMethod !== ZIP_DEFLATED)
  ) {
    return {};
  }
  return {
    bundleOffset: location.dataOffset,
    bundleCompressedSize: location.compressedSize,
    bundleCompression: location.compressionMethod,
  };
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
 * file headers) are widened to CHUNK_BYTES and cached — adjacent or
 * overlapping chunks are merged so a read never re-fetches bytes it already
 * has — and entry data reuses whatever prefix the cache holds (typically the
 * bytes following the local file header) before requesting the rest.
 */
export class HttpRangeReader extends RandomAccessReader {
  private chunks: { start: number; data: Buffer }[] = [];
  /** span a header read inside it should widen to (see `hintEntry`) */
  private hint: { start: number; end: number } | null = null;
  requests = 0;
  fetchedBytes = 0;

  constructor(
    private readonly url: string,
    readonly totalSize: number,
    tail?: { start: number; data: Buffer },
  ) {
    super();
    if (tail) this.addChunk(tail.start, tail.data);
  }

  /**
   * The next entry to be read: yauzl first reads its local file header, and
   * widening that read to the entry's data makes the data stream a cache hit
   * — one request for header + bundle instead of two. The central directory
   * may understate the local header's extra field, hence the slack.
   */
  hintEntry(entry: Entry): void {
    const start = entry.relativeOffsetOfLocalHeader;
    const end =
      start +
      LOCAL_HEADER_SIZE +
      entry.fileNameLength +
      entry.extraFieldLength +
      entry.compressedSize +
      HINT_SLACK_BYTES;
    this.hint = { start, end: Math.min(end, this.totalSize) };
  }

  /** Cache `data` at `start`, merging with any chunk it touches. */
  addChunk(start: number, data: Buffer): void {
    if (data.length === 0) return;
    let lo = start;
    let hi = start + data.length;
    const pieces: { start: number; data: Buffer }[] = [{ start, data }];
    const rest: { start: number; data: Buffer }[] = [];
    for (const chunk of this.chunks) {
      const chunkEnd = chunk.start + chunk.data.length;
      if (chunk.start <= hi && chunkEnd >= lo) {
        pieces.push(chunk);
        lo = Math.min(lo, chunk.start);
        hi = Math.max(hi, chunkEnd);
      } else {
        rest.push(chunk);
      }
    }
    if (pieces.length === 1) {
      rest.push(pieces[0]);
    } else {
      const merged = Buffer.alloc(hi - lo);
      // the new data is written last so it wins over stale overlaps
      for (const piece of pieces.reverse()) {
        piece.data.copy(merged, piece.start - lo);
      }
      rest.push({ start: lo, data: merged });
    }
    rest.sort((a, b) => a.start - b.start);
    this.chunks = rest;
  }

  /** cached bytes starting exactly at `start`, up to `end` (may be shorter) */
  private cachedPrefix(start: number, end: number): Buffer | null {
    for (const chunk of this.chunks) {
      const chunkEnd = chunk.start + chunk.data.length;
      if (start >= chunk.start && start < chunkEnd) {
        return chunk.data.subarray(
          start - chunk.start,
          Math.min(end, chunkEnd) - chunk.start,
        );
      }
    }
    return null;
  }

  private cached(start: number, end: number): Buffer | null {
    const prefix = this.cachedPrefix(start, end);
    return prefix && prefix.length === end - start ? prefix : null;
  }

  /** start of the cached chunk holding byte `end - 1`, when there is one */
  private cachedSuffixStart(end: number): number | null {
    for (const chunk of this.chunks) {
      if (end - 1 >= chunk.start && end - 1 < chunk.start + chunk.data.length) {
        return chunk.start;
      }
    }
    return null;
  }

  _readStreamForRange(start: number, end: number): Readable {
    const prefix = this.cachedPrefix(start, end);
    if (prefix && prefix.length === end - start) return Readable.from([prefix]);
    const out = new PassThrough();
    if (prefix) out.write(prefix);
    const from = start + (prefix?.length ?? 0);
    this.requests++;
    fetchRange(this.url, from, end)
      .then((response) => {
        this.fetchedBytes += end - from;
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
    // fetch only what the cache lacks: skip a cached prefix, stop at a cached
    // suffix (yauzl's EOCD read may just exceed the tail), and otherwise widen
    // so the next header read is free
    const requestEnd = position + length;
    const from =
      position + (this.cachedPrefix(position, requestEnd)?.length ?? 0);
    const suffixStart = this.cachedSuffixStart(requestEnd);
    let end: number;
    if (suffixStart !== null && suffixStart > from) {
      end = suffixStart;
    } else {
      end = Math.min(this.totalSize, Math.max(requestEnd, from + CHUNK_BYTES));
      if (
        this.hint &&
        position >= this.hint.start &&
        position < this.hint.end
      ) {
        end = Math.max(end, this.hint.end);
      }
    }
    this.requests++;
    fetchRangeBuffer(this.url, from, end).then(
      ({ data }) => {
        this.fetchedBytes += data.length;
        this.addChunk(from, data);
        const full = this.cached(position, position + length);
        if (!full) {
          callback(new Error('range read did not cover the requested bytes'));
          return;
        }
        full.copy(buffer, offset);
        callback(null, length);
      },
      (error) => callback(error),
    );
  }
}

/** End-of-central-directory record: where the central directory lives. */
const EOCD_SIGNATURE = 0x06054b50;
const EOCD_SIZE = 22;
/** central directories larger than this are left to yauzl's paged reads */
const MAX_PREFETCH_BYTES = 8 * 1024 * 1024;

export function parseEndOfCentralDirectory(
  tail: Buffer,
): { cdOffset: number; cdSize: number } | null {
  for (let i = tail.length - EOCD_SIZE; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIGNATURE) continue;
    const commentLength = tail.readUInt16LE(i + 20);
    if (i + EOCD_SIZE + commentLength !== tail.length) continue;
    const cdSize = tail.readUInt32LE(i + 12);
    const cdOffset = tail.readUInt32LE(i + 16);
    // zip64 markers: let yauzl resolve the real values itself
    if (cdSize === 0xffffffff || cdOffset === 0xffffffff) return null;
    return { cdOffset, cdSize };
  }
  return null;
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
  // Large archives (apk / ipa with thousands of files) keep their central
  // directory well before the tail; yauzl would otherwise page it in with one
  // sequential request per CHUNK_BYTES. Fetch the missing part at once.
  const eocd = parseEndOfCentralDirectory(data);
  if (
    eocd &&
    eocd.cdOffset < range.start &&
    range.start - eocd.cdOffset <= MAX_PREFETCH_BYTES
  ) {
    const { data: directory } = await fetchRangeBuffer(
      url,
      eocd.cdOffset,
      range.start,
    );
    reader.requests++;
    reader.fetchedBytes += directory.length;
    reader.addChunk(eocd.cdOffset, directory);
  }
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

/**
 * Read the first matching entry of an opened remote zip, then close it. With
 * `reader` given, the entry's header and data are fetched in one request.
 */
export function readRemoteZipEntry(
  zipFile: ZipFile,
  matches: (name: string) => boolean,
  reader?: HttpRangeReader,
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
      reader?.hintEntry(entry);
      readEntry(entry, zipFile).then(
        (data) => finish(null, data),
        (error) => finish(error),
      );
    });
    zipFile.readEntry();
  });
}
