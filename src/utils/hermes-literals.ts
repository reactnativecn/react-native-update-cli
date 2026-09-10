/**
 * Binary literal buffers of an HBC file, for the Hermes base equivalence
 * check (see docs/hermes-base-verification.md §3.2).
 *
 * `NewArrayWithBuffer` / `NewObjectWithBuffer` reference their literals by
 * *byte offset* into the serialized literal buffers. The text dump prints
 * those buffers entry by entry without byte positions, so the offsets in the
 * instructions cannot be mapped to entries from the dump alone — and a delta
 * build may lay the buffers out differently (deduplicated runs, different
 * order) while every instruction still resolves to the same literals. Reading
 * the buffers from the file and decoding at each instruction's offset
 * compares what the instruction actually builds.
 *
 * Serialized literal format (hermes SerializedLiteralGenerator): runs of
 * same-typed values. Tag byte: bits 6..4 = type, bit 7 = "length continues in
 * the next byte", bits 3..0 = low 4 bits of the run length (high 8 bits in
 * the next byte when bit 7 is set). Values follow the tag, fixed width per
 * type: none (null/true/false), 8-byte little-endian double, 4/2/1-byte
 * string id, 4-byte little-endian int32.
 */
import { open as openFile } from 'node:fs/promises';
import { resolveHbcSections } from './hbcTransform';

const HBC_HEADER_SIZE = 128;

const TAG_TYPE_MASK = 0x70;
const TAG_LENGTH_CONTINUES = 0x80;
const TAG_LENGTH_LOW = 0x0f;

enum Tag {
  Null = 0x00,
  True = 0x10,
  False = 0x20,
  Number = 0x30,
  LongString = 0x40,
  ShortString = 0x50,
  ByteString = 0x60,
  Integer = 0x70,
}

export type LiteralValue =
  | { kind: 'null' | 'true' | 'false' }
  | { kind: 'number'; value: number }
  | { kind: 'int'; value: number }
  | { kind: 'string'; id: number };

/** The three literal buffers of an HBC v87–96 file. */
export interface LiteralBuffers {
  version: number;
  array: Buffer;
  objectKeys: Buffer;
  objectValues: Buffer;
}

/**
 * Read only the literal buffers of an HBC file (header + three byte ranges,
 * never the whole file). Null for a file whose layout is unknown, including
 * HBC v98 (literalValueBuffer + objShapeTable, not decoded yet): the caller
 * then falls back to comparing the dumped buffers as a whole.
 */
export async function readLiteralBuffers(
  file: string,
): Promise<LiteralBuffers | null> {
  const handle = await openFile(file, 'r');
  try {
    const { size } = await handle.stat();
    if (size < HBC_HEADER_SIZE) return null;
    const header = Buffer.alloc(HBC_HEADER_SIZE);
    const read = await handle.read(header, 0, HBC_HEADER_SIZE, 0);
    if (read.bytesRead !== HBC_HEADER_SIZE) return null;
    const resolved = resolveHbcSections(header, size);
    if (!resolved) return null;
    const range = (name: string) => resolved.sections.get(name);
    const array = range('arrayBuffer');
    const objectKeys = range('objKeyBuffer');
    const objectValues = range('objValueBuffer');
    if (!array || !objectKeys || !objectValues) return null;
    const readRange = async (r: { start: number; size: number }) => {
      const buf = Buffer.alloc(r.size);
      if (r.size === 0) return buf;
      const { bytesRead } = await handle.read(buf, 0, r.size, r.start);
      return bytesRead === r.size ? buf : null;
    };
    const [a, k, v] = await Promise.all([
      readRange(array),
      readRange(objectKeys),
      readRange(objectValues),
    ]);
    if (!a || !k || !v) return null;
    return {
      version: resolved.version,
      array: a,
      objectKeys: k,
      objectValues: v,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Decode `count` literal values starting at byte `offset`. Null when the
 * offset or a run reaches outside the buffer or a tag type is unknown; the
 * caller reports that as a difference rather than guessing.
 */
export function decodeSerializedLiterals(
  buffer: Buffer,
  offset: number,
  count: number,
): LiteralValue[] | null {
  const values: LiteralValue[] = [];
  let pos = offset;
  while (values.length < count) {
    if (pos < 0 || pos >= buffer.length) return null;
    const tag = buffer[pos++];
    let length = tag & TAG_LENGTH_LOW;
    if (tag & TAG_LENGTH_CONTINUES) {
      if (pos >= buffer.length) return null;
      length = (length << 8) | buffer[pos++];
    }
    const type = tag & TAG_TYPE_MASK;
    for (let i = 0; i < length && values.length < count; i++) {
      switch (type) {
        case Tag.Null:
          values.push({ kind: 'null' });
          break;
        case Tag.True:
          values.push({ kind: 'true' });
          break;
        case Tag.False:
          values.push({ kind: 'false' });
          break;
        case Tag.Number:
          if (pos + 8 > buffer.length) return null;
          values.push({ kind: 'number', value: buffer.readDoubleLE(pos) });
          pos += 8;
          break;
        case Tag.LongString:
          if (pos + 4 > buffer.length) return null;
          values.push({ kind: 'string', id: buffer.readUInt32LE(pos) });
          pos += 4;
          break;
        case Tag.ShortString:
          if (pos + 2 > buffer.length) return null;
          values.push({ kind: 'string', id: buffer.readUInt16LE(pos) });
          pos += 2;
          break;
        case Tag.ByteString:
          if (pos + 1 > buffer.length) return null;
          values.push({ kind: 'string', id: buffer[pos] });
          pos += 1;
          break;
        case Tag.Integer:
          if (pos + 4 > buffer.length) return null;
          values.push({ kind: 'int', value: buffer.readInt32LE(pos) });
          pos += 4;
          break;
        default:
          return null;
      }
    }
  }
  return values;
}

/**
 * One literal as text, string ids resolved through the dump's string table
 * (an unknown id stays visible as `?id`). Doubles keep their exact bits in
 * the text so -0 and 0, or two NaNs, never collide by accident.
 */
export function renderLiteral(
  value: LiteralValue,
  strings: Map<number, string>,
): string {
  switch (value.kind) {
    case 'null':
    case 'true':
    case 'false':
      return value.kind;
    case 'int':
      return `[int ${value.value}]`;
    case 'number': {
      const bits = Buffer.alloc(8);
      bits.writeDoubleLE(value.value);
      return `[double ${Object.is(value.value, -0) ? '-0' : String(value.value)}#${bits.toString('hex')}]`;
    }
    case 'string': {
      const text = strings.get(value.id);
      return `[String ${text === undefined ? `?${value.id}` : JSON.stringify(text)}]`;
    }
  }
}

/**
 * Decodes the literals an instruction refers to, for one side of a compare.
 * Returns rendered entries, or null when the offset cannot be decoded.
 */
export class LiteralResolver {
  constructor(
    private readonly buffers: LiteralBuffers,
    private readonly strings: Map<number, string>,
  ) {}

  private decode(
    buffer: Buffer,
    offset: number,
    count: number,
  ): string[] | null {
    const values = decodeSerializedLiterals(buffer, offset, count);
    return values ? values.map((v) => renderLiteral(v, this.strings)) : null;
  }

  array(offset: number, count: number): string[] | null {
    return this.decode(this.buffers.array, offset, count);
  }

  objectKeys(offset: number, count: number): string[] | null {
    return this.decode(this.buffers.objectKeys, offset, count);
  }

  objectValues(offset: number, count: number): string[] | null {
    return this.decode(this.buffers.objectValues, offset, count);
  }
}
