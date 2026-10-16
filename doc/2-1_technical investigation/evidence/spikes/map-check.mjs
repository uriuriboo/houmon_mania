// 検証3 helper: map every check-in in saved list responses and report column fill rates / key-path frequencies.
// Usage: node map-check.mjs <response1.json> [response2.json ...]
//   each file: a raw /v2/users/self/checkins response ({meta,response:{checkins:{items}}}) or a bare array of items
import { readFileSync } from 'node:fs';
import { toRow } from './map.mjs';

const items = [];
for (const p of process.argv.slice(2)) {
  const j = JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, ''));
  const arr = Array.isArray(j) ? j : j?.response?.checkins?.items ?? [];
  items.push(...arr);
}
if (!items.length) { console.error('no items'); process.exit(1); }

const fill = {};
const errors = [];
const vals = { type: {}, visibility: {}, formattedAddressShape: {} };
for (const it of items) {
  try {
    const row = toRow(it, 'u');
    for (const [k, v] of Object.entries(row)) {
      if (k === 'raw' || k === 'user_id') continue;
      const has = Array.isArray(v) ? v.length > 0 : v !== null && v !== false && v !== 0;
      fill[k] = (fill[k] ?? 0) + (has ? 1 : 0);
    }
    vals.type[row.type] = (vals.type[row.type] ?? 0) + 1;
    vals.visibility[row.visibility ?? '(absent)'] = (vals.visibility[row.visibility ?? '(absent)'] ?? 0) + 1;
    const fa = it?.venue?.location?.formattedAddress;
    const shape = Array.isArray(fa) ? 'array' : fa && typeof fa === 'object' ? 'object' : 'absent';
    vals.formattedAddressShape[shape] = (vals.formattedAddressShape[shape] ?? 0) + 1;
  } catch (e) { errors.push(String(e.message)); }
}

// key-path frequency (arrays collapsed to [])
const pathCount = {};
function walk(o, prefix, seen) {
  if (o && typeof o === 'object') {
    if (Array.isArray(o)) { o.forEach((x) => walk(x, prefix + '[]', seen)); return; }
    for (const [k, v] of Object.entries(o)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (!seen.has(p)) { seen.add(p); pathCount[p] = (pathCount[p] ?? 0) + 1; }
      walk(v, p, seen);
    }
  }
}
for (const it of items) walk(it, '', new Set());

console.log(`items=${items.length} mapping_errors=${errors.length}`);
if (errors.length) console.log(errors.slice(0, 5));
console.log('--- column fill rate (non-null / non-empty / true / non-zero)');
for (const [k, n] of Object.entries(fill)) console.log(`${k.padEnd(22)} ${(100 * n / items.length).toFixed(1).padStart(5)}%`);
console.log('--- value distributions', JSON.stringify(vals));
console.log('--- top-level & venue key paths (% of items containing)');
for (const [p, n] of Object.entries(pathCount).sort((a, b) => b[1] - a[1])) {
  if (p.split('.').length <= 3 && !p.includes('[]')) console.log(`${p.padEnd(40)} ${(100 * n / items.length).toFixed(0).padStart(4)}%`);
}
