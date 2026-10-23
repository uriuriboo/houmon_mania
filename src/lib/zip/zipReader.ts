/**
 * 必要なファイルだけを取り出す ZIP の読み取り(9.2.2)。
 *
 * - ファイルを Blob.slice で部分的に読み、目次(central directory)から必要なファイルだけを展開する。
 *   写真の実ファイルを含む大きな ZIP でも、全体をメモリに読み込まない。
 * - ZIP64(4GB を超える ZIP、65,535 を超えるファイル数)を読める。
 * - 展開は DecompressionStream('deflate-raw') でストリームとして行い、実際に展開したバイト数で上限を判定して途中で止める
 *   (目次に書かれた大きさは信用しない)。
 * - 内部で Blob URL のワーカーなどを作らない(CSP の worker-src 'self' で動く)。
 *
 * 依存を増やさない(10.1 サプライチェーン対策)ため、必要な機能だけを自前で実装している。
 */

export type ZipErrorCode = 'NOT_ZIP' | 'TOO_MANY_ENTRIES' | 'UNSUPPORTED' | 'ENCRYPTED' | 'CORRUPT' | 'TOO_LARGE';

export class ZipError extends Error {
  public readonly code: ZipErrorCode;
  public constructor(code: ZipErrorCode, message: string) {
    super(message);
    this.name = 'ZipError';
    this.code = code;
  }
}

export type ZipEntry = {
  /** ZIP の中のパス(区切りは /) */
  readonly name: string;
  readonly method: number;
  readonly flags: number;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
};

export type ZipDirectory = {
  /** filter に一致したエントリ */
  readonly entries: ZipEntry[];
  /** 目次にあるファイルの総数 */
  readonly totalEntries: number;
};

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_MIN = 22;
const MAX_COMMENT = 0xffff;

const readSlice = async (blob: Blob, start: number, end: number): Promise<DataView> => {
  if (start < 0 || end > blob.size || start > end) throw new ZipError('CORRUPT', 'ZIP の構造が壊れています。');
  const buf = await blob.slice(start, end).arrayBuffer();
  return new DataView(buf);
};

const u64 = (view: DataView, offset: number): number => {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  const n = hi * 0x1_0000_0000 + lo;
  if (!Number.isSafeInteger(n)) throw new ZipError('UNSUPPORTED', 'ZIP が大きすぎます。');
  return n;
};

const utf8 = new TextDecoder('utf-8');

/**
 * ZIP の目次を読む。filter に一致したエントリだけを返す(名前の一覧を全部は持たない)。
 */
export const readZipDirectory = async (
  blob: Blob,
  options: { maxEntries: number; maxDirectoryBytes: number; filter: (name: string) => boolean },
): Promise<ZipDirectory> => {
  if (blob.size < EOCD_MIN) throw new ZipError('NOT_ZIP', 'ZIP ファイルではありません。');

  // 末尾から End of Central Directory を探す
  const tailStart = Math.max(0, blob.size - (EOCD_MIN + MAX_COMMENT));
  const tail = await readSlice(blob, tailStart, blob.size);
  let eocd = -1;
  for (let i = tail.byteLength - EOCD_MIN; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('NOT_ZIP', 'ZIP ファイルではありません。');

  const diskNo = tail.getUint16(eocd + 4, true);
  const cdDisk = tail.getUint16(eocd + 6, true);
  let totalEntries = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  const needsZip64 = totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff;
  const locatorPos = eocd - 20;
  if (locatorPos >= 0 && tail.getUint32(locatorPos, true) === SIG_ZIP64_LOCATOR) {
    const zip64EocdOffset = u64(tail, locatorPos + 8);
    const z = await readSlice(blob, zip64EocdOffset, Math.min(blob.size, zip64EocdOffset + 56));
    if (z.byteLength < 56 || z.getUint32(0, true) !== SIG_ZIP64_EOCD) throw new ZipError('CORRUPT', 'ZIP の構造が壊れています。');
    totalEntries = u64(z, 32);
    cdSize = u64(z, 40);
    cdOffset = u64(z, 48);
  } else if (needsZip64) {
    throw new ZipError('CORRUPT', 'ZIP の構造が壊れています。');
  } else if (diskNo !== 0 || cdDisk !== 0) {
    throw new ZipError('UNSUPPORTED', '分割された ZIP には対応していません。');
  }

  if (totalEntries > options.maxEntries) {
    throw new ZipError('TOO_MANY_ENTRIES', `ZIP の中のファイルが多すぎます(上限 ${options.maxEntries.toLocaleString('ja-JP')} 件)。`);
  }
  if (cdSize > options.maxDirectoryBytes) throw new ZipError('TOO_MANY_ENTRIES', 'ZIP の目次が大きすぎます。');
  if (cdOffset + cdSize > blob.size) throw new ZipError('CORRUPT', 'ZIP の構造が壊れています(ファイルが途中で切れている可能性があります)。');

  const cd = await readSlice(blob, cdOffset, cdOffset + cdSize);
  const entries: ZipEntry[] = [];
  let p = 0;
  for (let i = 0; i < totalEntries; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== SIG_CENTRAL) throw new ZipError('CORRUPT', 'ZIP の目次が壊れています。');
    const flags = cd.getUint16(p + 8, true);
    const method = cd.getUint16(p + 10, true);
    const crc32 = cd.getUint32(p + 16, true);
    let compressedSize = cd.getUint32(p + 20, true);
    let uncompressedSize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localHeaderOffset = cd.getUint32(p + 42, true);
    const nameStart = p + 46;
    const extraStart = nameStart + nameLen;
    const next = extraStart + extraLen + commentLen;
    if (next > cd.byteLength) throw new ZipError('CORRUPT', 'ZIP の目次が壊れています。');

    const name = utf8.decode(new Uint8Array(cd.buffer, cd.byteOffset + nameStart, nameLen)).replace(/\\/gu, '/');
    if (options.filter(name)) {
      // ZIP64 の拡張フィールド(0x0001)。0xFFFFFFFF になっている値だけが、この順に入っている
      if (uncompressedSize === 0xffffffff || compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
        let q = extraStart;
        const extraEnd = extraStart + extraLen;
        let found = false;
        while (q + 4 <= extraEnd) {
          const id = cd.getUint16(q, true);
          const size = cd.getUint16(q + 2, true);
          if (id === 0x0001) {
            let r = q + 4;
            const end = r + size;
            if (uncompressedSize === 0xffffffff && r + 8 <= end) {
              uncompressedSize = u64(cd, r);
              r += 8;
            }
            if (compressedSize === 0xffffffff && r + 8 <= end) {
              compressedSize = u64(cd, r);
              r += 8;
            }
            if (localHeaderOffset === 0xffffffff && r + 8 <= end) {
              localHeaderOffset = u64(cd, r);
            }
            found = true;
            break;
          }
          q += 4 + size;
        }
        if (!found) throw new ZipError('CORRUPT', 'ZIP の目次が壊れています。');
      }
      entries.push({ compressedSize, crc32, flags, localHeaderOffset, method, name, uncompressedSize });
    }
    p = next;
  }
  return { entries, totalEntries };
};

// ───────────────────────── CRC-32 ─────────────────────────
let crcTable: Uint32Array | null = null;
const getCrcTable = (): Uint32Array => {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  crcTable = t;
  return t;
};

export const crc32Update = (crc: number, data: Uint8Array): number => {
  const t = getCrcTable();
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

/**
 * エントリを展開する。実際に展開したバイト数が maxBytes を超えたら途中で止めて TOO_LARGE にする。
 */
export const extractZipEntry = async (blob: Blob, entry: ZipEntry, maxBytes: number): Promise<Uint8Array> => {
  if (entry.flags & 0x0001) throw new ZipError('ENCRYPTED', 'パスワード付きの ZIP には対応していません。');
  if (entry.method !== 0 && entry.method !== 8) throw new ZipError('UNSUPPORTED', 'この ZIP の圧縮形式には対応していません。');

  const local = await readSlice(blob, entry.localHeaderOffset, Math.min(blob.size, entry.localHeaderOffset + 30));
  if (local.byteLength < 30 || local.getUint32(0, true) !== SIG_LOCAL) throw new ZipError('CORRUPT', 'ZIP の構造が壊れています。');
  const dataStart = entry.localHeaderOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > blob.size) throw new ZipError('CORRUPT', 'ZIP の構造が壊れています(ファイルが途中で切れている可能性があります)。');

  const chunks: Uint8Array[] = [];
  let total = 0;
  let crc = 0;

  if (entry.method === 0) {
    if (entry.compressedSize > maxBytes) throw new ZipError('TOO_LARGE', 'ZIP の中のファイルが大きすぎます。');
    const data = new Uint8Array(await blob.slice(dataStart, dataEnd).arrayBuffer());
    chunks.push(data);
    total = data.length;
    crc = crc32Update(0, data);
  } else {
    const stream = blob.slice(dataStart, dataEnd).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) {
          await reader.cancel();
          throw new ZipError('TOO_LARGE', 'ZIP の中のファイルが大きすぎます。');
        }
        crc = crc32Update(crc, value);
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof ZipError) throw error;
      throw new ZipError('CORRUPT', 'ZIP の中のファイルを展開できませんでした(ファイルが壊れている可能性があります)。');
    }
  }

  if (total !== entry.uncompressedSize || crc !== entry.crc32) {
    throw new ZipError('CORRUPT', 'ZIP の中のファイルが壊れています。');
  }
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
};
