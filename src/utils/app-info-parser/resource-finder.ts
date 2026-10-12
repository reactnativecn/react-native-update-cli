/**
 * Code translated from a C# project https://github.com/hylander0/Iteedee.ApkReader/blob/master/Iteedee.ApkReader/ApkResourceFinder.cs
 *
 * Decode binary file `resources.arsc` from a .apk file to a JavaScript Object.
 */

/**
 * Little-endian cursor over a Buffer: the subset of the `bytebuffer` API this
 * decoder used. Reads past `limit` throw a RangeError, which the chunk loops
 * below rely on to stop at the end of the data.
 */
class Reader {
  offset = 0;
  readonly limit: number;

  constructor(readonly buffer: Buffer) {
    this.limit = buffer.length;
  }

  private advance(size: number) {
    const at = this.offset;
    if (at < 0 || at + size > this.limit) {
      throw new RangeError(
        `Illegal offset: 0 <= ${at} (+${size}) <= ${this.limit}`,
      );
    }
    this.offset = at + size;
    return at;
  }

  remaining() {
    return this.limit - this.offset;
  }

  readByte() {
    return this.buffer.readInt8(this.advance(1));
  }

  readUint8() {
    return this.buffer.readUInt8(this.advance(1));
  }

  readShort() {
    return this.buffer.readInt16LE(this.advance(2));
  }

  readUint16() {
    return this.buffer.readUInt16LE(this.advance(2));
  }

  readInt() {
    return this.buffer.readInt32LE(this.advance(4));
  }

  /** The next `len` bytes as a new reader (a view, not a copy). */
  readBytes(len: number) {
    const at = this.advance(len);
    return new Reader(this.buffer.subarray(at, at + len));
  }
}

/** The `size`-byte chunk starting at `pos`, cut short at the end of the data. */
function chunkAt(bb: Reader, pos: number, size: number) {
  return new Reader(bb.buffer.subarray(pos, pos + size));
}

const DEBUG = false;

const RES_STRING_POOL_TYPE = 0x0001;
const RES_TABLE_TYPE = 0x0002;
const RES_TABLE_PACKAGE_TYPE = 0x0200;
const RES_TABLE_TYPE_TYPE = 0x0201;
const RES_TABLE_TYPE_SPEC_TYPE = 0x0202;

const TYPE_REFERENCE = 0x01;
const TYPE_STRING = 0x03;

export class ResourceFinder {
  private valueStringPool: string[] | null = null;
  private typeStringPool: string[] | null = null;
  private keyStringPool: string[] | null = null;

  private packageId = 0;

  private responseMap: Record<string, any[]> = {};
  private entryMap: Record<number, string[]> = {};

  /**
   *
   * @param {Reader} bb
   * @return {Map<String, Set<String>>}
   */
  processResourceTable(resourceBuffer: Buffer) {
    const bb = new Reader(resourceBuffer);

    const type = bb.readShort();
    const headerSize = bb.readShort();
    const size = bb.readInt();
    const packageCount = bb.readInt();

    if (type !== RES_TABLE_TYPE) {
      throw new Error('No RES_TABLE_TYPE found!');
    }
    if (size !== bb.limit) {
      throw new Error(
        'The buffer size not matches to the resource table size.',
      );
    }
    bb.offset = headerSize;

    let realStringPoolCount = 0;
    let realPackageCount = 0;

    while (true) {
      let pos = 0;
      let t = 0;
      let _hs = 0;
      let s = 0;
      try {
        pos = bb.offset;
        t = bb.readShort();
        _hs = bb.readShort();
        s = bb.readInt();
      } catch (_e) {
        break;
      }
      if (t === RES_STRING_POOL_TYPE) {
        if (realStringPoolCount === 0) {
          if (DEBUG) {
            console.log('Processing the string pool ...');
          }

          this.valueStringPool = this.processStringPool(chunkAt(bb, pos, s));
        }
        realStringPoolCount++;
      } else if (t === RES_TABLE_PACKAGE_TYPE) {
        if (DEBUG) {
          console.log(`Processing the package ${realPackageCount} ...`);
        }

        this.processPackage(chunkAt(bb, pos, s));

        realPackageCount++;
      } else {
        throw new Error('Unsupported type');
      }
      bb.offset = pos + s;
      if (!bb.remaining()) break;
    }

    if (realStringPoolCount !== 1) {
      throw new Error('More than 1 string pool found!');
    }
    if (realPackageCount !== packageCount) {
      throw new Error('Real package count not equals the declared count.');
    }

    return this.responseMap;
  }

  /**
   *
   * @param {Reader} bb
   */
  private processPackage(bb: Reader) {
    const type = bb.readShort();
    const headerSize = bb.readShort();
    const size = bb.readInt();
    const id = bb.readInt();

    void type;
    void size;

    this.packageId = id;

    for (let i = 0; i < 256; ++i) {
      bb.readUint8();
    }

    const typeStrings = bb.readInt();
    const lastPublicType = bb.readInt();
    const keyStrings = bb.readInt();
    const lastPublicKey = bb.readInt();

    void lastPublicType;
    void lastPublicKey;

    if (typeStrings !== headerSize) {
      throw new Error(
        'TypeStrings must immediately following the package structure header.',
      );
    }

    if (DEBUG) {
      console.log('Type strings:');
    }

    let lastPosition = bb.offset;
    bb.offset = typeStrings;
    const bbTypeStrings = bb.readBytes(bb.limit - bb.offset);
    bb.offset = lastPosition;
    this.typeStringPool = this.processStringPool(bbTypeStrings);

    if (DEBUG) {
      console.log('Key strings:');
    }

    bb.offset = keyStrings;
    const keyType = bb.readShort();
    const keyHeaderSize = bb.readShort();
    const keySize = bb.readInt();

    void keyType;
    void keyHeaderSize;

    lastPosition = bb.offset;
    bb.offset = keyStrings;
    const bbKeyStrings = bb.readBytes(bb.limit - bb.offset);
    bb.offset = lastPosition;
    this.keyStringPool = this.processStringPool(bbKeyStrings);

    let typeSpecCount = 0;
    let typeCount = 0;

    bb.offset = keyStrings + keySize;

    let bb2: Reader;

    while (true) {
      const pos = bb.offset;
      try {
        const t = bb.readShort();
        const hs = bb.readShort();
        const s = bb.readInt();

        void hs;

        if (t === RES_TABLE_TYPE_SPEC_TYPE) {
          bb.offset = pos;
          bb2 = bb.readBytes(s);
          this.processTypeSpec(bb2);

          typeSpecCount++;
        } else if (t === RES_TABLE_TYPE_TYPE) {
          bb.offset = pos;
          bb2 = bb.readBytes(s);
          this.processType(bb2);

          typeCount++;
        }

        if (s === 0) {
          break;
        }

        bb.offset = pos + s;

        if (!bb.remaining()) {
          break;
        }
      } catch (_e) {
        break;
      }
    }

    void typeSpecCount;
    void typeCount;
  }

  /**
   *
   * @param {Reader} bb
   */
  private processType(bb: Reader) {
    const type = bb.readShort();
    const headerSize = bb.readShort();
    const size = bb.readInt();
    const id = bb.readByte();
    const res0 = bb.readByte();
    const res1 = bb.readShort();
    const entryCount = bb.readInt();
    const entriesStart = bb.readInt();

    void type;
    void size;
    void res0;
    void res1;

    const refKeys: Record<string, number> = {};

    const configSize = bb.readInt();

    void configSize;

    bb.offset = headerSize;

    if (headerSize + entryCount * 4 !== entriesStart) {
      throw new Error('HeaderSize, entryCount and entriesStart are not valid.');
    }

    const entryIndices = new Array<number>(entryCount);
    for (let i = 0; i < entryCount; ++i) {
      entryIndices[i] = bb.readInt();
    }

    for (let i = 0; i < entryCount; ++i) {
      if (entryIndices[i] === -1) continue;

      const resourceId = (this.packageId << 24) | (id << 16) | i;

      let entrySize = 0;
      let entryFlag = 0;
      let entryKey = 0;
      try {
        entrySize = bb.readShort();
        entryFlag = bb.readShort();
        entryKey = bb.readInt();
      } catch (_e) {
        break;
      }

      void entrySize;

      const FLAG_COMPLEX = 0x0001;
      if ((entryFlag & FLAG_COMPLEX) === 0) {
        const valueSize = bb.readShort();
        const valueRes0 = bb.readByte();
        const valueDataType = bb.readByte();
        const valueData = bb.readInt();

        void valueSize;
        void valueRes0;

        const idStr = Number(resourceId).toString(16);
        const keyStr = this.keyStringPool ? this.keyStringPool[entryKey] : '';

        let data: string | null = null;

        if (DEBUG) {
          console.log(`Entry 0x${idStr}, key: ${keyStr}, simple value type: `);
        }

        const key = Number.parseInt(idStr, 16);

        const entryArr = this.entryMap[key] ?? [];
        entryArr.push(keyStr);
        this.entryMap[key] = entryArr;

        if (valueDataType === TYPE_STRING) {
          data = this.valueStringPool ? this.valueStringPool[valueData] : null;

          if (DEBUG && this.valueStringPool) {
            console.log(`, data: ${this.valueStringPool[valueData]}`);
          }
        } else if (valueDataType === TYPE_REFERENCE) {
          refKeys[idStr] = valueData;
        } else {
          data = `${valueData}`;
          if (DEBUG) {
            console.log(`, data: ${valueData}`);
          }
        }

        this.putIntoMap(`@${idStr}`, data);
      } else {
        const entryParent = bb.readInt();
        const entryCountValue = bb.readInt();

        void entryParent;

        for (let j = 0; j < entryCountValue; ++j) {
          const refName = bb.readInt();
          const valueSize = bb.readShort();
          const valueRes0 = bb.readByte();
          const valueDataType = bb.readByte();
          const valueData = bb.readInt();

          void refName;
          void valueSize;
          void valueRes0;
          void valueDataType;
          void valueData;
        }

        if (DEBUG) {
          const keyStr = this.keyStringPool ? this.keyStringPool[entryKey] : '';
          console.log(
            `Entry 0x${Number(resourceId).toString(16)}, key: ${keyStr}, complex value, not printed.`,
          );
        }
      }
    }

    for (const refKey in refKeys) {
      const values =
        this.responseMap[
          `@${Number(refKeys[refKey]).toString(16).toUpperCase()}`
        ];
      if (values != null && Object.keys(values).length < 1000) {
        for (const value of values) {
          this.putIntoMap(`@${refKey}`, value);
        }
      }
    }
  }

  /**
   *
   * @param {Reader} bb
   * @return {Array}
   */
  private processStringPool(bb: Reader) {
    const type = bb.readShort();
    const headerSize = bb.readShort();
    const size = bb.readInt();
    const stringCount = bb.readInt();
    const styleCount = bb.readInt();
    const flags = bb.readInt();
    const stringsStart = bb.readInt();
    const stylesStart = bb.readInt();

    void type;
    void headerSize;
    void size;
    void styleCount;
    void stylesStart;

    const isUtf8 = (flags & 256) !== 0;

    const offsets = new Array<number>(stringCount);
    for (let i = 0; i < stringCount; ++i) {
      offsets[i] = bb.readInt();
    }

    const strings = new Array<string>(stringCount);

    for (let i = 0; i < stringCount; ++i) {
      const pos = stringsStart + offsets[i];
      bb.offset = pos;

      strings[i] = '';

      if (isUtf8) {
        let u16len = bb.readUint8();

        if ((u16len & 0x80) !== 0) {
          u16len = ((u16len & 0x7f) << 8) + bb.readUint8();
        }

        let u8len = bb.readUint8();
        if ((u8len & 0x80) !== 0) {
          u8len = ((u8len & 0x7f) << 8) + bb.readUint8();
        }

        if (u8len > 0) {
          strings[i] = bb.readBytes(u8len).buffer.toString('utf8');
        } else {
          strings[i] = '';
        }
      } else {
        let u16len = bb.readUint16();
        if ((u16len & 0x8000) !== 0) {
          u16len = ((u16len & 0x7fff) << 16) + bb.readUint16();
        }

        if (u16len > 0) {
          strings[i] = bb.readBytes(u16len * 2).buffer.toString('utf16le');
        }
      }

      if (DEBUG) {
        console.log('Parsed value: {0}', strings[i]);
      }
    }

    return strings;
  }

  /**
   *
   * @param {Reader} bb
   */
  private processTypeSpec(bb: Reader) {
    const type = bb.readShort();
    const headerSize = bb.readShort();
    const size = bb.readInt();
    const id = bb.readByte();
    const res0 = bb.readByte();
    const res1 = bb.readShort();
    const entryCount = bb.readInt();

    void type;
    void headerSize;
    void size;
    void res0;
    void res1;

    if (DEBUG && this.typeStringPool) {
      console.log(`Processing type spec ${this.typeStringPool[id - 1]}...`);
    }

    const flags = new Array<number>(entryCount);

    for (let i = 0; i < entryCount; ++i) {
      flags[i] = bb.readInt();
    }
  }

  private putIntoMap(resId: string, value: any) {
    const key = resId.toUpperCase();
    if (this.responseMap[key] == null) {
      this.responseMap[key] = [];
    }
    if (value) {
      this.responseMap[key].push(value);
    }
  }
}
