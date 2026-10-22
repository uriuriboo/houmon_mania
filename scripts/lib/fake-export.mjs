// 架空のデータから、Foursquare のエクスポートと同じ形のファイル一式を作る(L-05)。
// 形は 2026-10 に取得した実物(S-1)に合わせているが、ID・店名・コメント・位置・写真の URL はすべて架空。

/** 決定的な疑似乱数(mulberry32) */
const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// [英字表記の name, 現地語の canonicalName(無いものもある)]
const VENUES = [
  ['Kakuu Ramen Shibuya', '架空ラーメン 渋谷店'],
  ['Kakuu Ramen Shinjuku', '架空ラーメン 新宿店'],
  ['Mock Coffee Roasters', 'モックコーヒー 中目黒'],
  ['Sample Station', 'サンプル駅'],
  ['Dummy Books Jimbocho', 'ダミー書店 神保町'],
  ['Test Curry House', 'テストカレー 神田'],
  ['Placeholder Park', 'プレースホルダー公園'],
  ['H&M Fake Store', undefined],
  ["Tully's Test Cafe", undefined],
  ['ＺＥＮＫＡＫＵ Bar', undefined],
  ['Café Ünïcode', undefined],
  ['Fiction Gym', 'フィクションジム'],
  ['Example Sushi', '例示寿司'],
  ['Imaginary Udon', '空想うどん'],
  ['Pretend Bakery', 'つもりベーカリー'],
  ['Sample Office Tower', 'サンプルオフィスタワー'],
];

const SHOUTS = ['替え玉2回', 'うまい!', 'Kareoke time!', '雨', '12:30 集合', '今日は混んでた', 'ひとり反省会', '朝活', 'OR と AND の検索テスト', '"引用符"入り'];
const TZ = [540, 540, 540, 540, 540, 540, -300, 330, 0, 60];
const VIS = ['closeFriends', 'closeFriends', 'closeFriends', 'closeFriends', undefined, 'private', 'public'];

const hex = (r, n = 24) => {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(r() * 16).toString(16);
  return s;
};
const b64 = (r, n) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let s = '';
  for (let i = 0; i < n; i++) s += chars[Math.floor(r() * chars.length)];
  return s;
};
const pad = (n, w = 2) => String(n).padStart(w, '0');
const fmt = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.000000`;
};

/**
 * @param {{ count?: number, seed?: number, perFile?: number, photoRatio?: number, now?: number,
 *           start?: number, invalid?: number, unknownKey?: boolean, extras?: boolean, singleFile?: boolean,
 *           userId?: string }} [opts]
 * @returns {{ files: Record<string, string | Uint8Array>, checkins: any[], photos: any[] }}
 */
export const generateFakeExport = (opts = {}) => {
  const {
    count = 2500,
    seed = 1,
    perFile = 1000,
    photoRatio = 0.15,
    now = Date.UTC(2026, 9, 14, 10, 0, 0),
    start = Date.UTC(2021, 0, 1),
    invalid = 0,
    unknownKey = false,
    extras = true,
    singleFile = false,
    userId = '900000001',
  } = opts;
  const r = rng(seed);

  const times = Array.from({ length: count }, () => Math.floor(start + r() * (now - start)));
  times.sort((a, b) => b - a); // 実物と同じく新しい順

  const checkins = times.map((t, i) => {
    const [name, canonicalName] = VENUES[Math.floor(r() * VENUES.length)];
    const id = hex(r);
    const venueId = hex(r);
    const c = {
      id,
      createdAt: fmt(t),
      type: 'checkin',
      entities: [],
      timeZoneOffset: TZ[Math.floor(r() * TZ.length)],
      editableUntil: fmt(t + 86_400_000),
      canonicalUrl: `https://app.foursquare.com/user/checkin/${id}?s=${b64(r, 27)}&ref=tw`,
      venue: { id: venueId, name, url: `https://app.foursquare.com/v/${encodeURIComponent(name.toLowerCase().replace(/\s+/g, '-'))}/${venueId}` },
      lat: 35 + r(),
      lng: 139 + r(),
      hacc: Math.floor(r() * 50),
      comments: { count: r() < 0.01 ? 1 : 0 },
    };
    if (canonicalName) c.venue.canonicalName = canonicalName;
    const vis = VIS[Math.floor(r() * VIS.length)];
    if (vis) c.visibility = vis;
    if (r() < 0.12) c.shout = SHOUTS[Math.floor(r() * SHOUTS.length)];
    if (i === 3) c.event = { id: hex(r), name: '架空フェス 2026', categories: [], canonicalUrl: 'https://app.foursquare.com/e/x' };
    if (unknownKey && i === 5) c.brandNewField = { x: 1 };
    return c;
  });

  // 不正なレコード(id はあるが createdAt が無い / id も無い)
  for (let k = 0; k < invalid; k++) {
    checkins.push(k % 2 === 0 ? { id: hex(r), type: 'checkin' } : { createdAt: fmt(now - 1000), type: 'checkin' });
  }

  const photos = [];
  for (const c of checkins) {
    if (!c.id || !c.createdAt || r() >= photoRatio) continue;
    const n = 1 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const id = hex(r);
      const suffix = `/${userId}_${b64(r, 43)}.jpg`;
      photos.push({
        id,
        createdAt: c.createdAt,
        prefix: 'https://fastly.4sqi.net/img/general/',
        suffix,
        width: 1440,
        height: 1920,
        visibility: 'public',
        fullUrl: `https://fastly.4sqi.net/img/general/1440x1920${suffix}`,
        relatedItemUrl: `https://swarmapp.com/checkin/${c.id}`,
        canonicalUrl: `https://app.foursquare.com/user/photo/${id}?s=${b64(r, 27)}&ref=tw`,
      });
    }
  }

  const files = {};
  if (singleFile) {
    files['checkins.json'] = JSON.stringify({ count: checkins.length, items: checkins });
  } else {
    for (let i = 0; i * perFile < Math.max(checkins.length, 1); i++) {
      const items = checkins.slice(i * perFile, (i + 1) * perFile);
      files[`checkins${i + 1}.json`] = JSON.stringify({ count: items.length, items });
    }
  }
  files['photos1.json'] = JSON.stringify({ count: photos.length, items: photos });

  if (extras) {
    // 本アプリが読み込まないファイル(第三者のデータ・支払い・端末情報など)
    files['users.json'] = JSON.stringify({
      self: { id: userId, firstName: 'Taro', email: 'taro@example.invalid', handle: 'fake_taro' },
      friends: { count: 1, items: [{ id: '900000002', firstName: 'Hanako', lastName: 'Example', canonicalUrl: 'https://app.foursquare.com/user/900000002' }] },
    });
    files['comments.json'] = JSON.stringify({ count: 1, items: [{ comment: '友人のコメント(架空)', time: fmt(now), userId: 900000002 }] });
    files['shares.json'] = JSON.stringify({ count: 0, items: [] });
    files['uniqueDevices.json'] = JSON.stringify({ count: 1, items: [{ id: hex(r), deviceToken: 'fake-token', isActive: true }] });
    files['venueRatings.json'] = JSON.stringify({ venueLikes: [], venueOkays: [], venueDislikes: [] });
    files['paymentProfiles.json'] = JSON.stringify({ activeProfiles: [], removedProfiles: [] });
    files['checkins1.csv'] = 'id,createdAt\n';
    files['readme.html'] = '<p>fake readme</p>';
    for (const p of photos.slice(0, 3)) files[`pix${p.suffix}`] = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  }
  return { checkins, files, photos };
};
