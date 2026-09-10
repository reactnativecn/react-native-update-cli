import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import {
  LITERAL_SEPARATOR,
  normalizeDisassemblyLine,
} from '../src/utils/hermes-base';
import {
  decodeSerializedLiterals,
  LiteralResolver,
  readLiteralBuffers,
  renderLiteral,
} from '../src/utils/hermes-literals';

const HERMESC_CANDIDATES = [
  path.resolve(
    __dirname,
    '../../react-native-update/node_modules/react-native/sdks/hermesc/linux64-bin/hermesc',
  ),
  path.resolve(
    __dirname,
    '../../react-native-update/node_modules/react-native/sdks/hermesc/osx-bin/hermesc',
  ),
];
const hermesc =
  process.env.HERMESC || HERMESC_CANDIDATES.find((p) => fs.existsSync(p));
const hasHermesc = Boolean(hermesc) && fs.existsSync(hermesc!);

/** tag byte: type | length (≤ 15) */
const tag = (type: number, length: number) => type | length;
const NULL = 0x00;
const TRUE = 0x10;
const FALSE = 0x20;
const NUMBER = 0x30;
const LONG_STRING = 0x40;
const SHORT_STRING = 0x50;
const BYTE_STRING = 0x60;
const INTEGER = 0x70;

const u16 = (n: number) => [n & 0xff, n >> 8];
const i32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return [...b];
};
const f64 = (n: number) => {
  const b = Buffer.alloc(8);
  b.writeDoubleLE(n);
  return [...b];
};

describe('decodeSerializedLiterals', () => {
  test('every tag type, fixed value widths, runs of several entries', () => {
    const buf = Buffer.from([
      tag(SHORT_STRING, 2),
      ...u16(300),
      ...u16(7),
      tag(INTEGER, 1),
      ...i32(-42),
      tag(NUMBER, 1),
      ...f64(2.5),
      tag(BYTE_STRING, 1),
      0x52,
      tag(NULL, 1),
      tag(TRUE, 2),
      tag(FALSE, 1),
      tag(LONG_STRING, 1),
      ...i32(70000),
    ]);
    expect(decodeSerializedLiterals(buf, 0, 10)).toEqual([
      { kind: 'string', id: 300 },
      { kind: 'string', id: 7 },
      { kind: 'int', value: -42 },
      { kind: 'number', value: 2.5 },
      { kind: 'string', id: 82 },
      { kind: 'null' },
      { kind: 'true' },
      { kind: 'true' },
      { kind: 'false' },
      { kind: 'string', id: 70000 },
    ]);
    // a count shorter than the run stops inside it
    expect(decodeSerializedLiterals(buf, 0, 1)).toEqual([
      { kind: 'string', id: 300 },
    ]);
  });

  test('a run longer than 15 carries its length in a second byte', () => {
    const entries = 1000;
    const bytes = [0x80 | SHORT_STRING | (entries >> 8), entries & 0xff];
    for (let i = 0; i < entries; i++) bytes.push(...u16(i));
    const values = decodeSerializedLiterals(Buffer.from(bytes), 0, entries);
    expect(values).toHaveLength(entries);
    expect(values![999]).toEqual({ kind: 'string', id: 999 });
  });

  test('offsets may start inside an earlier literal (the builder overlaps them)', () => {
    // seen in a real build: literal A = [..., [String 82]] ends with the
    // value byte 0x52, and literal B starts at that same byte, where 0x52 is
    // read as a tag (two short strings) — a sequential parse of the buffer
    // cannot see B, only the instruction offsets can
    const buf = Buffer.from([
      tag(BYTE_STRING, 1),
      0x52,
      0xcd,
      0x09,
      0xb3,
      0x05,
      tag(TRUE, 1),
    ]);
    expect(decodeSerializedLiterals(buf, 0, 1)).toEqual([
      { kind: 'string', id: 82 },
    ]);
    expect(decodeSerializedLiterals(buf, 1, 3)).toEqual([
      { kind: 'string', id: 0x09cd },
      { kind: 'string', id: 0x05b3 },
      { kind: 'true' },
    ]);
  });

  test('reaching outside the buffer is null, never a guess', () => {
    const buf = Buffer.from([tag(INTEGER, 2), ...i32(1)]);
    expect(decodeSerializedLiterals(buf, 0, 1)).toEqual([
      { kind: 'int', value: 1 },
    ]);
    expect(decodeSerializedLiterals(buf, 0, 2)).toBeNull();
    expect(decodeSerializedLiterals(buf, 5, 1)).toBeNull();
    expect(decodeSerializedLiterals(buf, -1, 1)).toBeNull();
    expect(
      decodeSerializedLiterals(Buffer.from([0x80 | NULL]), 0, 1),
    ).toBeNull();
  });
});

describe('renderLiteral', () => {
  const strings = new Map([[82, 'color']]);
  test('strings resolve through the table; unknown ids stay visible', () => {
    expect(renderLiteral({ kind: 'string', id: 82 }, strings)).toBe(
      '[String "color"]',
    );
    expect(renderLiteral({ kind: 'string', id: 5 }, strings)).toBe(
      '[String ?5]',
    );
  });
  test('doubles keep their bits: -0 and 0 differ, two NaNs agree', () => {
    const zero = renderLiteral({ kind: 'number', value: 0 }, strings);
    const negZero = renderLiteral({ kind: 'number', value: -0 }, strings);
    expect(zero).not.toBe(negZero);
    expect(negZero.startsWith('[double -0#')).toBe(true);
    expect(renderLiteral({ kind: 'number', value: NaN }, strings)).toBe(
      renderLiteral({ kind: 'number', value: NaN }, strings),
    );
    expect(renderLiteral({ kind: 'int', value: 7 }, strings)).toBe('[int 7]');
    expect(renderLiteral({ kind: 'null' }, strings)).toBe('null');
  });
});

describe('normalizeDisassemblyLine with binary literals', () => {
  const strings = new Map([
    [1, 'a'],
    [2, 'b'],
    [3, 'k'],
  ]);
  const array = Buffer.from([
    tag(BYTE_STRING, 2),
    1,
    2,
    tag(INTEGER, 1),
    ...i32(9),
  ]);
  const keys = Buffer.from([tag(BYTE_STRING, 1), 3]);
  const values = Buffer.from([tag(TRUE, 1)]);
  const resolver = new LiteralResolver(
    { version: 96, array, objectKeys: keys, objectValues: values },
    strings,
  );

  test('New*WithBuffer lines carry the decoded literals, width suffix folded', () => {
    expect(
      normalizeDisassemblyLine(
        '    NewArrayWithBufferLong r4, 3, 3, 0',
        strings,
        resolver,
      ),
    ).toBe(
      `    NewArrayWithBuffer r4 size=3 n=3 [[String "a"]${LITERAL_SEPARATOR}[String "b"]${LITERAL_SEPARATOR}[int 9]]`,
    );
    // an offset into the second run only sees what starts there
    expect(
      normalizeDisassemblyLine(
        '    NewArrayWithBuffer r4, 1, 1, 3',
        strings,
        resolver,
      ),
    ).toBe('    NewArrayWithBuffer r4 size=1 n=1 [[int 9]]');
    expect(
      normalizeDisassemblyLine(
        '    NewObjectWithBuffer r1, 1, 1, 0, 0',
        strings,
        resolver,
      ),
    ).toBe('    NewObjectWithBuffer r1 size=1 n=1 {[String "k"]: true}');
  });

  test('an undecodable offset is spelled out so it never matches a decoded one', () => {
    expect(
      normalizeDisassemblyLine(
        '    NewArrayWithBuffer r4, 2, 2, 9',
        strings,
        resolver,
      ),
    ).toBe('    NewArrayWithBuffer r4 size=2 n=2 [<undecodable@9>]');
  });

  test('without buffers only the size hint survives (whole-buffer fallback)', () => {
    expect(
      normalizeDisassemblyLine(
        '    NewArrayWithBufferLong r4, 3, 3, 0',
        strings,
      ),
    ).toBe('    NewArrayWithBuffer r4 sizes=3');
  });
});

describe('readLiteralBuffers', () => {
  test('a file without a known layout is null', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-literals-'));
    try {
      const file = path.join(dir, 'x.hbc');
      const buf = Buffer.alloc(200);
      Buffer.from('c61fbc03c103191f', 'hex').copy(buf, 0);
      buf.writeUInt32LE(96, 8);
      fs.writeFileSync(file, buf);
      expect(await readLiteralBuffers(file)).toBeNull();
      fs.writeFileSync(file, Buffer.from('not hbc'));
      expect(await readLiteralBuffers(file)).toBeNull();
    } finally {
      fs.removeSync(dir);
    }
  });

  test.if(hasHermesc)(
    'decodes what each instruction of a real build refers to',
    async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rnu-literals-real-'));
      try {
        const js = path.join(dir, 'a.js');
        const hbc = path.join(dir, 'a.hbc');
        fs.writeFileSync(
          js,
          'var a = ["color", 1, null, 2.5]; var b = {k: true, m: "color"}; print(a, b);\n',
        );
        expect(
          spawnSync(hermesc!, ['-emit-binary', '-out', hbc, js, '-O', '-w'], {
            stdio: 'ignore',
          }).status,
        ).toBe(0);
        const dump = spawnSync(
          hermesc!,
          ['-b', '-dump-bytecode', '-pretty-disassemble', hbc],
          { encoding: 'utf8' },
        ).stdout;
        const strings = new Map<number, string>();
        for (const line of dump.split('\n')) {
          const m = /^\s*[is](\d+)\[[^\]]*\](?: #[0-9A-F]+)?: (.*)$/.exec(line);
          if (m) strings.set(Number(m[1]), m[2]);
        }
        const buffers = await readLiteralBuffers(hbc);
        expect(buffers).not.toBeNull();
        const resolver = new LiteralResolver(buffers!, strings);
        const array = /NewArrayWithBuffer\w*\s+r\d+, \d+, (\d+), (\d+)/.exec(
          dump,
        )!;
        expect(resolver.array(Number(array[2]), Number(array[1]))).toEqual([
          '[String "color"]',
          '[int 1]',
          'null',
          expect.stringMatching(/^\[double 2\.5#/),
        ]);
        const object =
          /NewObjectWithBuffer\w*\s+r\d+, \d+, (\d+), (\d+), (\d+)/.exec(dump)!;
        expect(
          resolver.objectKeys(Number(object[2]), Number(object[1])),
        ).toEqual(['[String "k"]', '[String "m"]']);
        expect(
          resolver.objectValues(Number(object[3]), Number(object[1])),
        ).toEqual(['true', '[String "color"]']);
      } finally {
        fs.removeSync(dir);
      }
    },
  );
});
