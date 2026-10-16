// 検証3 helper: key-path diff between a list item and a details item of the same check-in.
// Usage: node keydiff.mjs <list-response.json> <details-response.json> [checkinId]
import { readFileSync } from 'node:fs';
const read = (p) => JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
const [listPath, detPath, idArg] = process.argv.slice(2);
const det = read(detPath)?.response?.checkin;
const id = idArg ?? det?.id;
const listItem = (read(listPath)?.response?.checkins?.items ?? []).find((x) => x.id === id);
if (!det || !listItem) { console.error('not found', { id, hasDet: !!det, hasList: !!listItem }); process.exit(1); }

function paths(o, prefix = '', out = new Map()) {
  if (o && typeof o === 'object') {
    if (Array.isArray(o)) { out.set(prefix + '[]', `array(${o.length})`); o.slice(0, 1).forEach((x) => paths(x, prefix + '[]', out)); return out; }
    for (const [k, v] of Object.entries(o)) { const p = prefix ? `${prefix}.${k}` : k; out.set(p, v && typeof v === 'object' ? (Array.isArray(v) ? `array(${v.length})` : 'object') : JSON.stringify(v)); paths(v, p, out); }
  }
  return out;
}
const L = paths(listItem), D = paths(det);
const onlyDet = [...D.keys()].filter((k) => !L.has(k));
const onlyList = [...L.keys()].filter((k) => !D.has(k));
const changed = [...D.keys()].filter((k) => L.has(k) && L.get(k) !== D.get(k) && !['object'].includes(D.get(k)));
console.log(`checkin ${id}`);
console.log('--- only in DETAILS'); onlyDet.forEach((k) => console.log(`  + ${k} = ${D.get(k)}`));
console.log('--- only in LIST'); onlyList.forEach((k) => console.log(`  - ${k} = ${L.get(k)}`));
console.log('--- value differs'); changed.forEach((k) => console.log(`  ~ ${k}: list=${L.get(k)} details=${D.get(k)}`));
