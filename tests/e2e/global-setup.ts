import fs from 'node:fs';
import path from 'node:path';
import { generateFakeExport } from '../../scripts/lib/fake-export.mjs';
import { createZip } from '../../scripts/lib/zip-writer.mjs';

export const FIXTURE_DIR = path.join(import.meta.dirname, '../../test-results/fixtures');
export const FIXTURE_ZIP = path.join(FIXTURE_DIR, 'fake-export-1200.zip');
export const FIXTURE_FOLDER = path.join(FIXTURE_DIR, 'data-export-0000000042');

/** 架空データの疑似エクスポート(ZIP と展開済みのフォルダ)を作る */
export default function globalSetup() {
  const { files } = generateFakeExport({ count: 1200, photoRatio: 0.2, seed: 42 });
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  const root = 'data-export-0000000042';
  fs.writeFileSync(FIXTURE_ZIP, createZip(Object.entries(files).map(([name, data]) => ({ data, name: `${root}/${name}` }))));
  fs.rmSync(FIXTURE_FOLDER, { force: true, recursive: true });
  for (const [name, data] of Object.entries(files)) {
    const p = path.join(FIXTURE_FOLDER, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
  }
}
