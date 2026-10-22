import { describe, expect, it } from 'vitest';
import { extractZipEntry, readZipDirectory, ZipError } from '@/lib/zip/zipReader';
import { createZip } from '../../scripts/lib/zip-writer.mjs';

const OPTS = { filter: (n: string) => n.endsWith('.json'), maxDirectoryBytes: 1 << 20, maxEntries: 1000 };
const toBlob = (buf: Uint8Array) => new Blob([new Uint8Array(buf)]);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

describe('readZipDirectory / extractZipEntry', () => {
  const files = [
    { data: '{"count":1,"items":[{"a":"日本語"}]}', name: 'data-export-1/checkins1.json' },
    { data: 'x'.repeat(5000), method: 0 as const, name: 'data-export-1/photos1.json' },
    { data: new Uint8Array([1, 2, 3]), name: 'data-export-1/pix/a.jpg' },
  ];

  it.each([false, true])('目次から必要なファイルだけを選び、展開する(zip64=%s)', async (zip64) => {
    const blob = toBlob(createZip(files, { comment: 'hello', zip64 }));
    const dir = await readZipDirectory(blob, OPTS);
    expect(dir.totalEntries).toBe(3);
    expect(dir.entries.map((e) => e.name)).toEqual(['data-export-1/checkins1.json', 'data-export-1/photos1.json']);
    expect(decode(await extractZipEntry(blob, dir.entries[0]!, 1 << 20))).toBe(files[0]!.data);
    expect(decode(await extractZipEntry(blob, dir.entries[1]!, 1 << 20))).toBe(files[1]!.data);
  });

  it('実際に展開したバイト数で上限を判定して止める(deflate・stored)', async () => {
    const big = [
      { data: 'a'.repeat(200_000), name: 'big.json' },
      { data: 'b'.repeat(2_000), method: 0 as const, name: 'stored.json' },
    ];
    const blob = toBlob(createZip(big));
    const dir = await readZipDirectory(blob, OPTS);
    await expect(extractZipEntry(blob, dir.entries[0]!, 100_000)).rejects.toMatchObject({ code: 'TOO_LARGE' });
    await expect(extractZipEntry(blob, dir.entries[1]!, 1_000)).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('目次の大きさを偽った ZIP(圧縮爆弾)も、実際の展開量で止める', async () => {
    const blob = toBlob(createZip([{ data: 'z'.repeat(500_000), name: 'bomb.json' }]));
    const dir = await readZipDirectory(blob, OPTS);
    const lying = { ...dir.entries[0]!, uncompressedSize: 10 };
    await expect(extractZipEntry(blob, lying, 1_000)).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('ファイル数の上限', async () => {
    const blob = toBlob(createZip(files));
    await expect(readZipDirectory(blob, { ...OPTS, maxEntries: 2 })).rejects.toMatchObject({ code: 'TOO_MANY_ENTRIES' });
  });

  it('ZIP でないファイル', async () => {
    await expect(readZipDirectory(new Blob(['{"not":"zip"} padding padding']), OPTS)).rejects.toMatchObject({ code: 'NOT_ZIP' });
    await expect(readZipDirectory(new Blob(['x']), OPTS)).rejects.toBeInstanceOf(ZipError);
  });

  it('途中で切れた ZIP', async () => {
    const buf = createZip(files);
    const truncated = toBlob(buf.subarray(40));
    await expect(readZipDirectory(truncated, OPTS)).rejects.toBeInstanceOf(ZipError);
  });

  it('壊れたデータは CRC で検知する', async () => {
    const buf = Buffer.from(createZip([{ data: 'hello world', method: 0, name: 'a.json' }]));
    const dataStart = 30 + 'a.json'.length;
    buf[dataStart] = 'H'.charCodeAt(0);
    const blob = toBlob(buf);
    const dir = await readZipDirectory(blob, OPTS);
    await expect(extractZipEntry(blob, dir.entries[0]!, 1000)).rejects.toMatchObject({ code: 'CORRUPT' });
  });
});
