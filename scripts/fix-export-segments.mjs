// Windows でビルドしたときだけ必要な補正。
//
// Next.js 16.4 の静的書き出しは、ページの先読み用のファイルを `out/search/__next.search.__PAGE__.txt` のように
// 区切りを "." にした名前で書き出す(クライアントもこの名前で取得する)。ところが Windows でビルドすると、
// 区切りが "\" のまま残り、`out/search/__next.search/__PAGE__.txt` というフォルダとして書き出されて 404 になる。
// Linux(Vercel のビルド環境)では起きないため、この処理は何もしない。
//
//   node scripts/fix-export-segments.mjs [outDir]
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.argv[2] ?? 'out');
let moved = 0;

const flatten = (dir, prefix, targetDir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) flatten(p, `${prefix}.${e.name}`, targetDir);
    else {
      fs.renameSync(p, path.join(targetDir, `${prefix}.${e.name}`));
      moved += 1;
    }
  }
  fs.rmdirSync(dir);
};

const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const p = path.join(dir, e.name);
    if (e.name.startsWith('__next.')) flatten(p, e.name, dir);
    else if (e.name !== '_next') walk(p);
  }
};

if (fs.existsSync(outDir)) walk(outDir);
if (moved > 0) console.log(`fix-export-segments: ${moved} files`);
