// テスト用の最小の ZIP 書き出し(stored / deflate、ZIP64 の強制)。アプリには含めない。
import zlib from 'node:zlib';

const toBytes = (data) => (typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data));

/**
 * @param {{ name: string, data: string | Uint8Array, method?: 0 | 8 }[]} files
 * @param {{ zip64?: boolean, comment?: string }} [options]
 * @returns {Buffer}
 */
export const createZip = (files, options = {}) => {
  const zip64 = options.zip64 === true;
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const raw = toBytes(f.data);
    const method = f.method ?? 8;
    const body = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const crc = zlib.crc32(raw);

    const localExtra = zip64 ? Buffer.alloc(20) : Buffer.alloc(0);
    if (zip64) {
      localExtra.writeUInt16LE(0x0001, 0);
      localExtra.writeUInt16LE(16, 2);
      localExtra.writeBigUInt64LE(BigInt(raw.length), 4);
      localExtra.writeBigUInt64LE(BigInt(body.length), 12);
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(zip64 ? 45 : 20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x5a21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(zip64 ? 0xffffffff : body.length, 18);
    local.writeUInt32LE(zip64 ? 0xffffffff : raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    chunks.push(local, name, localExtra, body);

    const cenExtra = zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
    if (zip64) {
      cenExtra.writeUInt16LE(0x0001, 0);
      cenExtra.writeUInt16LE(24, 2);
      cenExtra.writeBigUInt64LE(BigInt(raw.length), 4);
      cenExtra.writeBigUInt64LE(BigInt(body.length), 12);
      cenExtra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(zip64 ? 45 : 20, 4);
    cen.writeUInt16LE(zip64 ? 45 : 20, 6);
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(0, 12);
    cen.writeUInt16LE(0x5a21, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(zip64 ? 0xffffffff : body.length, 20);
    cen.writeUInt32LE(zip64 ? 0xffffffff : raw.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(cenExtra.length, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE(zip64 ? 0xffffffff : offset, 42);
    central.push(cen, name, cenExtra);

    offset += local.length + name.length + localExtra.length + body.length;
  }

  const cdOffset = offset;
  const cdBuf = Buffer.concat(central);
  chunks.push(cdBuf);
  offset += cdBuf.length;

  if (zip64) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0);
    z.writeBigUInt64LE(44n, 4);
    z.writeUInt16LE(45, 12);
    z.writeUInt16LE(45, 14);
    z.writeUInt32LE(0, 16);
    z.writeUInt32LE(0, 20);
    z.writeBigUInt64LE(BigInt(files.length), 24);
    z.writeBigUInt64LE(BigInt(files.length), 32);
    z.writeBigUInt64LE(BigInt(cdBuf.length), 40);
    z.writeBigUInt64LE(BigInt(cdOffset), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeUInt32LE(0, 4);
    loc.writeBigUInt64LE(BigInt(offset), 8);
    loc.writeUInt32LE(1, 16);
    chunks.push(z, loc);
  }

  const comment = Buffer.from(options.comment ?? '', 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(zip64 ? 0xffff : files.length, 8);
  eocd.writeUInt16LE(zip64 ? 0xffff : files.length, 10);
  eocd.writeUInt32LE(zip64 ? 0xffffffff : cdBuf.length, 12);
  eocd.writeUInt32LE(zip64 ? 0xffffffff : cdOffset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  chunks.push(eocd, comment);
  return Buffer.concat(chunks);
};
