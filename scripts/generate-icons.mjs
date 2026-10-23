// アイコン(足あと)の PNG を生成する。依存なし(図形をスーパーサンプリングで塗り、zlib で PNG にする)。
//   node scripts/generate-icons.mjs
// 出力: public/icon-192.png, public/icon-512.png, public/icon-maskable-512.png, public/apple-touch-icon.png
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ORANGE = [0xea, 0x58, 0x0c];
const WHITE = [0xff, 0xff, 0xff];

// 32x32 の座標系での図形(src/components/logo.tsx と同じ)
const SHAPES = [
  { a: 1, cx: 11.5, cy: 19, rot: -12, rx: 3.6, ry: 5.2 },
  { a: 1, cx: 8.6, cy: 11.2, r: 1.3 },
  { a: 1, cx: 11.6, cy: 10.2, r: 1.3 },
  { a: 1, cx: 14.4, cy: 11, r: 1.2 },
  { a: 0.85, cx: 21, cy: 14.5, rot: 14, rx: 3.3, ry: 4.8 },
  { a: 0.85, cx: 18.6, cy: 7.4, r: 1.2 },
  { a: 0.85, cx: 21.4, cy: 6.9, r: 1.2 },
  { a: 0.85, cx: 24, cy: 8, r: 1.1 },
];

const inShape = (s, x, y) => {
  if (s.r !== undefined) return (x - s.cx) ** 2 + (y - s.cy) ** 2 <= s.r ** 2;
  const t = (-s.rot * Math.PI) / 180;
  const dx = x - s.cx;
  const dy = y - s.cy;
  const u = dx * Math.cos(t) - dy * Math.sin(t);
  const v = dx * Math.sin(t) + dy * Math.cos(t);
  return (u / s.rx) ** 2 + (v / s.ry) ** 2 <= 1;
};

const inRoundRect = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), 32 - r);
  const cy = Math.min(Math.max(y, r), 32 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

/** @param {{ size: number, radius: number, scale: number }} o */
const render = ({ size, radius, scale }) => {
  const px = Buffer.alloc(size * size * 4);
  const SS = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const x = ((i + (si + 0.5) / SS) / size) * 32;
          const y = ((j + (sj + 0.5) / SS) / size) * 32;
          if (!inRoundRect(x, y, radius)) continue;
          let c = ORANGE;
          // 中身は中心を基準に scale 倍(maskable の安全領域に収めるため)
          const lx = 16 + (x - 16) / scale;
          const ly = 16 + (y - 16) / scale;
          for (const s of SHAPES) {
            if (inShape(s, lx, ly)) c = c.map((v, k) => v * (1 - s.a) + WHITE[k] * s.a);
          }
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
      const n = SS * SS;
      const o = (j * size + i) * 4;
      const cov = a / n / 255;
      px[o] = cov ? Math.round(r / n / cov) : 0;
      px[o + 1] = cov ? Math.round(g / n / cov) : 0;
      px[o + 2] = cov ? Math.round(b / n / cov) : 0;
      px[o + 3] = Math.round(a / n);
    }
  }
  return px;
};

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

const png = (size, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const out = path.join(import.meta.dirname, '..', 'public');
const targets = [
  { file: 'icon-192.png', radius: 7, scale: 1, size: 192 },
  { file: 'icon-512.png', radius: 7, scale: 1, size: 512 },
  { file: 'icon-maskable-512.png', radius: 0, scale: 0.78, size: 512 },
  { file: 'apple-touch-icon.png', radius: 0, scale: 0.86, size: 180 },
];
for (const t of targets) {
  fs.writeFileSync(path.join(out, t.file), png(t.size, render(t)));
  console.log('wrote', t.file);
}
