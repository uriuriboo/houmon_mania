// 架空データの疑似エクスポートを作る(L-05)。取り込み・検索・性能のテストに使う。
//
//   node scripts/generate-fixture.mjs [--count 5000] [--out local-data/fake-export.zip] [--folder] [--zip64] [--seed 1]
//
// --folder を付けると ZIP ではなく展開済みのフォルダとして書き出す。出力先の既定は local-data/(.gitignore 済み)。
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { generateFakeExport } from './lib/fake-export.mjs';
import { createZip } from './lib/zip-writer.mjs';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '5000' },
    seed: { type: 'string', default: '1' },
    out: { type: 'string' },
    folder: { type: 'boolean', default: false },
    zip64: { type: 'boolean', default: false },
    invalid: { type: 'string', default: '0' },
  },
});

const count = Number(values.count);
const { files, checkins, photos } = generateFakeExport({ count, invalid: Number(values.invalid), seed: Number(values.seed) });
const root = `data-export-${String(values.seed).padStart(10, '0')}`;
const out = values.out ?? path.join('local-data', values.folder ? root : `fake-export-${count}.zip`);

if (values.folder) {
  for (const [name, data] of Object.entries(files)) {
    const p = path.join(out, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
} else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const entries = Object.entries(files).map(([name, data]) => ({ data, name: `${root}/${name}` }));
  fs.writeFileSync(out, createZip(entries, { zip64: values.zip64 }));
}
console.log(`wrote ${out} (checkins ${checkins.length}, photos ${photos.length})`);
