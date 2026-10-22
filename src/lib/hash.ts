/**
 * 内容のハッシュ(6.2 content_hash)。再取り込みで「変更なし」を判定するためだけに使う。
 * 暗号用途ではないため、同期的に計算できる 64 ビットの非暗号ハッシュ(cyrb53 系を2系統)を使う。
 */
export const contentHash = (s: string): string => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  let h3 = 0x9e3779b9;
  let h4 = 0x85ebca6b;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
    h3 = Math.imul(h3 ^ c, 2246822507);
    h4 = Math.imul(h4 ^ c, 3266489909);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  h3 = Math.imul(h3 ^ (h3 >>> 16), 2654435761) ^ Math.imul(h4 ^ (h4 >>> 13), 1597334677);
  h4 = Math.imul(h4 ^ (h4 >>> 16), 2654435761) ^ Math.imul(h3 ^ (h3 >>> 13), 1597334677);
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return hex(h1 ^ h4) + hex(h2 ^ h3);
};
