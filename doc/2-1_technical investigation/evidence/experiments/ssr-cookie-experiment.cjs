// Offline experiment: @supabase/ssr 0.12.7 + @supabase/supabase-js 2.118.0 behaviour
// Usage: node ssr-cookie-experiment.cjs <path-to-dir-with-node_modules>
// No network access: all HTTP calls go to a mock fetch.
'use strict';
const { createRequire } = require('module');
const path = require('path');

const pkgDir = process.argv[2];
if (!pkgDir) {
  console.error('usage: node ssr-cookie-experiment.cjs <pkgDir>');
  process.exit(2);
}
const req = createRequire(path.join(pkgDir, 'package.json'));
const { createServerClient } = req('@supabase/ssr');
const { createClient } = req('@supabase/supabase-js');

// Node 20 has no global WebSocket; supabase-js 2.118 throws without a transport. Dummy (never connects).
class DummyWS { constructor() { throw new Error('should not connect'); } }
const SUPABASE_URL = 'https://abcdefghijklmnopqrst.supabase.co';
const PUBLISHABLE = 'sb_publishable_TESTTESTTEST';
const SECRET = 'sb_secret_TESTTESTTEST';
const enc = new TextEncoder();
const b64u = (buf) => Buffer.from(buf).toString('base64url');

async function makeSigner() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', kp.publicKey);
  jwk.kid = 'test-kid-1';
  jwk.alg = 'ES256';
  jwk.use = 'sig';
  jwk.key_ops = ['verify'];
  const sign = async (payload) => {
    const header = { alg: 'ES256', kid: jwk.kid, typ: 'JWT' };
    const h = b64u(enc.encode(JSON.stringify(header)));
    const p = b64u(enc.encode(JSON.stringify(payload)));
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kp.privateKey, enc.encode(`${h}.${p}`));
    return `${h}.${p}.${b64u(sig)}`;
  };
  return { jwk, sign };
}

function decodeCookieValue(v) {
  if (v.startsWith('base64-')) return Buffer.from(v.slice(7), 'base64url').toString('utf8');
  return v;
}

(async () => {
  const signer = await makeSigner();
  const now = Math.floor(Date.now() / 1000);
  const userId = '11111111-2222-3333-4444-555555555555';
  const user = {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'u_7f3c9a@users.example.invalid',
    email_confirmed_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'], fsq_user_id: '12345678' },
    user_metadata: { display_name: 'Taro' },
    identities: [],
    created_at: new Date().toISOString(),
    is_anonymous: false,
  };
  const accessToken = await signer.sign({
    iss: `${SUPABASE_URL}/auth/v1`, sub: userId, aud: 'authenticated', role: 'authenticated',
    exp: now + 3600, iat: now, session_id: '99999999-8888-7777-6666-555555555555', aal: 'aal1',
    email: user.email, app_metadata: user.app_metadata, user_metadata: user.user_metadata, is_anonymous: false,
  });

  const calls = [];
  const mockFetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const headers = new Headers(init && init.headers);
    calls.push({
      method: (init && init.method) || 'GET',
      url: url.replace(SUPABASE_URL, ''),
      apikey: headers.get('apikey'),
      authorization: headers.get('authorization') ? headers.get('authorization').slice(0, 40) + '...' : null,
      sbForwardedFor: headers.get('sb-forwarded-for'),
    });
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    if (url.includes('/auth/v1/verify')) {
      // Same response shape as /token?grant_type=pkce would have for an OAuth login incl. provider_token
      return json({
        access_token: accessToken, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600,
        refresh_token: 'refresh-token-1', user, provider_token: 'FSQ_ACCESS_TOKEN_MUST_NOT_LEAK',
      });
    }
    if (url.includes('/auth/v1/.well-known/jwks.json')) return json({ keys: [signer.jwk] });
    if (url.includes('/auth/v1/logout')) return new Response(null, { status: 204 });
    if (url.includes('/auth/v1/user')) return json(user);
    if (url.includes('/rest/v1/')) return json([]);
    return json({});
  };

  // ---------- Test 1: server client (publishable key) + httpOnly cookieOptions + verifyOtp ----------
  const jar = new Map();
  const setAllLog = [];
  const makeCookieMethods = (j, log) => ({
    getAll: () => [...j].map(([name, value]) => ({ name, value })),
    setAll: (cookies, headers) => {
      log.push({ cookies: cookies.map((c) => ({ name: c.name, len: c.value.length, options: c.options })), headers });
      for (const c of cookies) {
        if (c.value === '' || (c.options && c.options.maxAge === 0)) j.delete(c.name);
        else j.set(c.name, c.value);
      }
    },
  });
  const sb = createServerClient(SUPABASE_URL, PUBLISHABLE, {
    cookies: makeCookieMethods(jar, setAllLog),
    cookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    global: { fetch: mockFetch }, realtime: { transport: DummyWS },
  });
  const v = await sb.auth.verifyOtp({ token_hash: 'dummy-hash', type: 'email' });
  console.log('=== Test1 verifyOtp error:', v.error ? v.error.message : null);
  console.log('=== Test1 setAll calls:', JSON.stringify(setAllLog, null, 2));
  const cookieNames = [...jar.keys()];
  console.log('=== Test1 cookie names:', cookieNames);
  const joined = cookieNames.sort().map((n) => jar.get(n)).join('');
  const decoded = decodeCookieValue(joined);
  console.log('=== Test1 decoded cookie length:', decoded.length);
  console.log('=== Test1 cookie contains provider_token?:', decoded.includes('FSQ_ACCESS_TOKEN_MUST_NOT_LEAK'));
  console.log('=== Test1 cookie top-level keys:', Object.keys(JSON.parse(decoded)));

  // ---------- Test 2: getClaims() verifies locally using JWKS (no /user call) ----------
  calls.length = 0;
  const sb2 = createServerClient(SUPABASE_URL, PUBLISHABLE, {
    cookies: makeCookieMethods(jar, []),
    global: { fetch: mockFetch }, realtime: { transport: DummyWS },
  });
  const c = await sb2.auth.getClaims();
  console.log('=== Test2 getClaims error:', c.error ? c.error.message : null, ' sub:', c.data && c.data.claims.sub);
  console.log('=== Test2 HTTP calls made by getClaims:', JSON.stringify(calls));

  // ---------- Test 3: PostgREST request headers: secret-key client with and without session ----------
  calls.length = 0;
  const admin = createClient(SUPABASE_URL, SECRET, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: mockFetch }, realtime: { transport: DummyWS },
  });
  await admin.from('checkins').select('*').limit(1);
  const secretWithCookies = createServerClient(SUPABASE_URL, SECRET, {
    cookies: makeCookieMethods(jar, []),
    global: { fetch: mockFetch }, realtime: { transport: DummyWS },
  });
  await secretWithCookies.from('checkins').select('*').limit(1); // has user session in cookies
  const emptyJar = new Map();
  const secretNoSession = createServerClient(SUPABASE_URL, SECRET, {
    cookies: makeCookieMethods(emptyJar, []),
    global: { fetch: mockFetch }, realtime: { transport: DummyWS },
  });
  await secretNoSession.from('checkins').select('*').limit(1); // no session -> key used
  const pubNoSession = createServerClient(SUPABASE_URL, PUBLISHABLE, {
    cookies: makeCookieMethods(emptyJar, []),
    global: { fetch: mockFetch }, realtime: { transport: DummyWS },
  });
  await pubNoSession.from('checkins').select('*').limit(1);
  console.log('=== Test3 REST calls [admin(no session), secret+cookies(session), secret+cookies(no session), publishable(no session)]:');
  console.log(JSON.stringify(calls, null, 2));

  // ---------- Test 4: tokens-only encoding size ----------
  const jar4 = new Map();
  const sb4 = createServerClient(SUPABASE_URL, PUBLISHABLE, {
    cookies: { ...makeCookieMethods(jar4, []), encode: 'tokens-only' },
    global: { fetch: mockFetch }, realtime: { transport: DummyWS },
  });
  await sb4.auth.verifyOtp({ token_hash: 'dummy-hash', type: 'email' });
  const joined4 = [...jar4.keys()].sort().map((n) => jar4.get(n)).join('');
  const decoded4 = decodeCookieValue(joined4);
  console.log('=== Test4 tokens-only cookie names:', [...jar4.keys()], ' decoded length:', decoded4.length, ' keys:', Object.keys(JSON.parse(decoded4)));
  console.log('=== Test4 tokens-only contains provider_token?:', decoded4.includes('FSQ_ACCESS_TOKEN_MUST_NOT_LEAK'));

  // ---------- Test 5: signOut({scope:'local'}) ----------
  calls.length = 0;
  const outLog = [];
  const sb5 = createServerClient(SUPABASE_URL, PUBLISHABLE, {
    cookies: makeCookieMethods(jar, outLog),
    cookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    global: { fetch: mockFetch }, realtime: { transport: DummyWS },
  });
  const so = await sb5.auth.signOut({ scope: 'local' });
  console.log('=== Test5 signOut error:', so.error ? so.error.message : null);
  console.log('=== Test5 HTTP calls:', JSON.stringify(calls));
  console.log('=== Test5 setAll (cookie removal):', JSON.stringify(outLog));
  console.log('=== Test5 remaining cookies:', [...jar.keys()]);

  // ---------- Test 6: sb-forwarded-for propagated on auth (/verify) requests with secret key ----------
  calls.length = 0;
  const jar6 = new Map();
  const sb6 = createServerClient(SUPABASE_URL, SECRET, {
    cookies: makeCookieMethods(jar6, []),
    cookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    global: { fetch: mockFetch, headers: { 'sb-forwarded-for': '203.0.113.7' } },
    realtime: { transport: DummyWS },
  });
  const v6 = await sb6.auth.verifyOtp({ token_hash: 'dummy-hash', type: 'email' });
  console.log('=== Test6 verifyOtp error:', v6.error ? v6.error.message : null);
  console.log('=== Test6 HTTP calls:', JSON.stringify(calls));

  // ---------- Test 7: decoupled issuance: secret-key verifier (no cookies) -> publishable cookie client setSession ----------
  calls.length = 0;
  const verifier = createClient(SUPABASE_URL, SECRET, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: mockFetch, headers: { 'sb-forwarded-for': '198.51.100.23' } },
    realtime: { transport: DummyWS },
  });
  const v7 = await verifier.auth.verifyOtp({ token_hash: 'dummy-hash', type: 'email' });
  const jar7 = new Map();
  const log7 = [];
  const cookieClient = createServerClient(SUPABASE_URL, PUBLISHABLE, {
    cookies: makeCookieMethods(jar7, log7),
    cookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' },
    global: { fetch: mockFetch },
    realtime: { transport: DummyWS },
  });
  const s7 = await cookieClient.auth.setSession({
    access_token: v7.data.session.access_token,
    refresh_token: v7.data.session.refresh_token,
  });
  const joined7 = [...jar7.keys()].sort().map((n) => jar7.get(n)).join('');
  const decoded7 = decodeCookieValue(joined7);
  console.log('=== Test7 verify error:', v7.error ? v7.error.message : null, ' setSession error:', s7.error ? s7.error.message : null);
  console.log('=== Test7 HTTP calls:', JSON.stringify(calls));
  console.log('=== Test7 cookie options:', JSON.stringify(log7.map((l) => l.cookies.map((c) => ({ name: c.name, httpOnly: c.options.httpOnly, secure: c.options.secure })))));
  console.log('=== Test7 cookie contains provider_token?:', decoded7.includes('FSQ_ACCESS_TOKEN_MUST_NOT_LEAK'), ' keys:', Object.keys(JSON.parse(decoded7)));
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});

