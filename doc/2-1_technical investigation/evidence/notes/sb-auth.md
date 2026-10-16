# 調査メモ: sb-auth — 外部OAuth(Foursquare)ログイン後に Supabase ユーザー作成・セッション発行をサーバー側で行う方式

- 調査日: 2026-10-16
- 対応要件: F-01, F-05, N-02 / 着手事項 検証1
- 調査者メモ: 一次情報は (1) Supabase 公式ドキュメントの MDX ソース (github.com/supabase/supabase/apps/docs)、(2) supabase/auth (GoTrue) の master ソース、(3) npm レジストリ、(4) npm から取得した @supabase/ssr 0.12.7 / @supabase/auth-js 2.118.0 / @supabase/supabase-js 2.118.0 の dist コード、(5) モック fetch によるオフライン実験。実 Supabase プロジェクト・実 Foursquare アカウントでの検証はしていない(Docker 無し、クレデンシャル無し)。
- 作業ディレクトリ(すべてスクラッチパッド内):
  - `sb-docs/` … Supabase docs MDX / examples の生ファイル
  - `sb-auth-src/` … supabase/auth の Go ソース(master)
  - `sb-cli-src/` … supabase/cli (develop) の Go ソース・config.toml テンプレート・Dockerfile
  - `pkg-ssr/`, `pkg-authjs/`, `pkg-supabasejs/` … npm pack した tarball の展開
  - `exp-sb-auth/` … 実験用 npm プロジェクト(@supabase/ssr 0.12.7 + supabase-js 2.118.0)
  - `exp-scripts/` … 実験スクリプトと出力(`ssr-cookie-experiment.cjs`, `ssr-cookie-experiment.out.txt`, `checkmail-test.cjs`)

---

## 0. 結論サマリ(2026年10月時点の推奨)

1. **Foursquare は Supabase Auth の標準プロバイダに無い**。2026年春に追加された Custom OAuth/OIDC Providers(`custom:` 識別子、`provider_type: 'oauth2'` で authorization/token/userinfo URL を手動指定)で「素の OAuth2」も登録自体は可能だが、userinfo レスポンスの**トップレベルに `sub`(文字列)が必須**で、attribute_mapping も**トップレベルの既知クレーム名どうしの付け替えしかできない**。Foursquare の `GET /v2/users/self` は `{"meta":…,"response":{"user":{"id":…}}}` というネスト構造なので**そのままでは "error missing provider id" で失敗する**。自前の userinfo アダプタ(Route Handler)を挟めば理論上は動くが、(i) PKCE 交換結果の `provider_token`(=Foursquare access_token)が @supabase/ssr のセッション Cookie に保存されてブラウザへ送られる(実験で確認)、(ii) `auth.flow_state` に provider token が平文で一時保存される、(iii) F-05(OAuth 再実行なしの再ログイン)は結局別手段が必要、という理由で**MVP の主方式には推奨しない**。
2. **推奨は方式(a)**: Foursquare OAuth は Next.js の Route Handler で自前実装(state Cookie で CSRF 対策)→ サーバーで `users/self` を叩いて fsq_user_id 確定 → secret key の admin クライアントで `auth.admin.createUser({ email: 合成メール, email_confirm: true, app_metadata })`(初回のみ)→ `auth.admin.generateLink({ type: 'magiclink', email })` の `properties.hashed_token` → サーバー側で `auth.verifyOtp({ token_hash, type: 'email' })` → @supabase/ssr の Cookie(httpOnly 指定可)にセッション保存。
   - メールは一切送信されない(admin generate_link はリンク生成のみ。ソースで確認)。
   - 合成メールは**形式チェック(badoux/checkmail の正規表現)のみ**で、MX/DNS チェックや `.invalid` 等の予約 TLD ブロックは「メール送信時」のラッパー(validateclient)でしか行われない → createUser / generateLink では弾かれない(ソース根拠。実機確認は要)。
   - Auth の `DisableSignup`(新規サインアップ無効)や Email プロバイダ無効化は admin createUser / generate_link / verify の経路ではチェックされていない(ソース根拠)→ 公開のメール系エンドポイントを閉じたまま運用できる見込み(要実機確認)。
3. **レート制限が最大の運用リスク**: `/verify` は IP 単位 30回/5分(バースト30)、`/token`(refresh/password/pkce)は 150回/5分(バースト30)。サーバーから呼ぶとサーバーの送信元 IP に集中する。対策は (A) `Sb-Forwarded-For` ヘッダ(**secret key で呼ぶ場合のみ有効、新規プロジェクトは明示的に有効化が必要**)で利用者 IP を渡す、(B) ダッシュボード/Management API でレート制限値を引き上げる。
4. **バージョン**: @supabase/ssr 0.12.7(2026-09-08)、@supabase/supabase-js 2.118.0(2026-10-15)、Next.js 16.4.2(2026-10-15)、Supabase CLI 2.121.0(2026-10-14、ローカル GoTrue v2.197.0)。**supabase-js は 2.110.0(2026-06-30)以降 `engines.node >=22`**。開発機の Node v20.11.1 では `createServerClient()` 生成時点で `Node.js detected but native WebSocket not found` 例外になる(実験で再現)→ **Node 22 以上への更新が必須**。
5. **Next.js 16 では `middleware.ts` → `proxy.ts`(Node.js ランタイム固定)**。Supabase 公式の SSR パターンは proxy で `getClaims()` を呼んでトークン更新を Cookie に書き戻す。Cloudflare(OpenNext)では proxy.ts(Node middleware)対応が 2026-08-25 マージの**実験的機能**でメンテナがサポート対象外と明言 → ホスティング選定に影響。
6. **httpOnly Cookie + ブラウザ用クライアント不使用**は公式に「サーバーのみでロジックを実装する従来型 Web アプリなら可能(ライブラリのサポートは限定的)」。@supabase/ssr の `cookieOptions: { httpOnly: true }` は実際に反映される(実験で確認。maxAge は 400日固定で上書き不可)。公式 FAQ は「httpOnly は不要」という立場。
7. **secret key クライアントは必ず Cookie 非連携で別インスタンス**。supabase-js 2.118 は「ユーザーセッションがあれば `Authorization: Bearer <ユーザーJWT>`(=RLS 適用)、無ければ `Authorization: Bearer sb_secret_…`(=service_role、RLS バイパス)」を送る(実験で確認)。Cookie 連携クライアントに secret key を渡すと、Cookie 欠落時に**黙って RLS バイパス**に昇格する。
8. **F-05 は「端末記憶トークン(remember-device)」方式で実現可能**だが、実質「ログアウト後もその端末からはワンクリックで再ログインできる」= 共有端末リスクを受け入れる設計判断になる。httpOnly/`__Host-` Cookie + DB はハッシュのみ + ローテーション + 再利用検知 + 有効期限 + 端末一覧/失効 UI + 再開時に Foursquare `users/self` で有効性確認、をセットで実装する。

---

## 1. npm バージョン確認(PowerShell 実行結果)

```text
> npm view @supabase/ssr version time.modified dist-tags --json
{ "version": "0.12.7", "time.modified": "2026-09-08T08:14:28.302Z",
  "dist-tags": { "patched": "0.4.1", "latest": "0.12.7", "rc": "0.12.7-rc.162" } }

> npm view @supabase/supabase-js version dist-tags --json
{ "version": "2.118.0",
  "dist-tags": { "rc": "2.100.0-rc.0", "next": "3.0.0-next.29", "beta": "2.112.0-beta.0",
                 "latest": "2.118.0", "canary": "2.118.0-canary.2" } }
  (auth-js も 2.118.0。2.118.0 公開: 2026-10-15T12:59:04Z)

> npm view supabase version  → 2.121.0 (2026-10-14)
> npm view next version      → 16.4.2  (16.0.0 は 2025-10-22、16.4.0 は 2026-10-06)

> npm view next@16.4.2 engines            → { "node": ">=20.9.0" }
> npm view @supabase/supabase-js@2.118.0 engines → { "node": ">=22.0.0" }
> npm view @supabase/ssr@0.12.7 peerDependencies → { "@supabase/supabase-js": "^2.114.0" }, dependencies: { "cookie": "^1.0.2" }

engines.node の推移(supabase-js):
  2.79.0〜2.109.0 => >=20.0.0
  2.110.0 (2026-06-30) => >=22.0.0
```

@supabase/ssr のリリース: 0.12.0 (2026-06-09) … 0.12.5 (2026-08-24), 0.12.6 (2026-09-04), 0.12.7 (2026-09-08)。

Node 20 での実行結果(exp-sb-auth で npm install 後、createServerClient を呼んだだけ):

```text
⚠️  Node.js 20 and below are deprecated and will no longer be supported in future versions of @supabase/supabase-js. Please upgrade to Node.js 22 or later. ... https://github.com/orgs/supabase/discussions/45715
FATAL Error: Node.js detected but native WebSocket not found.
Suggested solution: Ensure you are running Node.js 22+ or provide a WebSocket implementation via the transport option.
    at WebSocketFactory.getWebSocketConstructor (.../@supabase/realtime-js/dist/main/lib/websocket-factory.js:86:15)
    ...
    at createServerClient (.../@supabase/ssr/dist/main/createServerClient.js:22:51)
```

→ Realtime を使わなくても SupabaseClient コンストラクタで RealtimeClient が初期化されるため落ちる。`realtime: { transport: ダミークラス }` を渡せば回避できる(実験ではこれで回避)が、正攻法は Node 22+。discussion #45715: Node 20 は 2026-04-30 EOL、supabase-js の Node 20 サポートは 2026-06-30 で終了。

---

## 2. 調査項目1: Foursquare 標準プロバイダ有無 / Custom OAuth プロバイダ

### 2.1 標準プロバイダ
- supabase/auth の `internal/api/provider/` には apple, azure, bitbucket, discord, facebook, figma, fly, github, gitlab, google, kakao, keycloak, linkedin(_oidc), notion, slack(_oidc), snapchat, spotify, twitch, twitter, x, vercel_marketplace, workos, zoom と custom_oauth/oidc のみ。**foursquare は無い**。
- CLI の config.toml テンプレートのコメントでも外部プロバイダ一覧に Foursquare は無い。

### 2.2 Custom OAuth/OIDC Providers(2026年追加)
- 公式: https://supabase.com/docs/guides/auth/custom-oauth-providers
  - 識別子は `custom:` 接頭辞、2〜50文字。
  - `provider_type: 'oauth2'`(authorization_url / token_url / userinfo_url を手動指定)と `'oidc'`(issuer から discovery)。
  - Free プランは3個まで、Pro 以上は無制限。
  - `pkce_enabled` 既定 true(false 可)、`email_optional` 既定 false(メール無しを許可するなら true)、`authorization_params`、`acceptable_client_ids`、OIDC 用 `discovery_url` / `skip_nonce_check`。
  - サインインは `signInWithOAuth({ provider: 'custom:xxx' })`。
- リリース: Developer Update - May 2026(v1.26.05, 2026-05-07)に "Custom OAuth/OIDC providers for Supabase Auth" 掲載。self-hosted は Auth v2.196.0 以上。ローカル CLI 2.121.0 の GoTrue は v2.197.0(Dockerfile で確認)なので admin API 経由で作成できる見込み(推測)。config.toml には custom provider の設定項目は無い。
- auth-js 2.118 の型には `attribute_mapping?: Record<string, any>` と `custom_claims_allowlist?: string[]` もある(ドキュメント本文には未記載)。

### 2.3 ソースで確認した「Foursquare で詰まる点」

`internal/api/provider/custom_oauth.go`(master):
```go
func (p *CustomOAuthProvider) GetUserData(ctx context.Context, tok *oauth2.Token) (*UserProvidedData, error) {
	claims, raw, err := fetchUserinfoClaims(ctx, tok, p.config, p.userinfoURL)
	...
	captureAllowedClaims(raw, p.customClaimsAllowlist, &claims)
	if len(p.attributeMapping) > 0 {
		claims = applyAttributeMapping(claims, p.attributeMapping)
	}
	...
}
// applyAttributeMapping: Claims 構造体を map にしてから
//   case string: if value, exists := claimsMap[v]; exists { claimsMap[targetField] = value }
//   default:     claimsMap[targetField] = v   // リテラル値
```
- userinfo は `makeRequest` → `g.Client(ctx, tok)` で **GET + `Authorization: Bearer <access_token>`**(golang.org/x/oauth2 のトランスポート)。
- マッピング元は **Claims 構造体の既知フィールド(sub, name, picture, email, full_name, avatar_url, …)のトップレベル**のみ。ネストパス不可。`id` のような非標準キーは allowlist に入れても `custom_claims` の下に入るので `sub` へ付け替えできない(テストも「既存フィールド間の付け替え」と「リテラル値」のみ)。

`internal/models/identity.go`:
```go
func NewIdentity(user *User, provider string, identityData map[string]interface{}) (*Identity, error) {
	providerId, ok := identityData["sub"]
	if !ok {
		return nil, errors.New("error missing provider id")
	}
```
→ userinfo にトップレベル `sub` が無いと失敗。GitHub issue supabase/auth#2519(2026-05-05 起票、Open、修正 PR #2528 も Open)は SUAP という IdP で全く同じ "missing provider id" を報告(userinfo が `id` を返し `sub` を返さないケース)。

`internal/api/external.go`:
```go
if len(userData.Emails) == 0 && !emailOptional {
	return apierrors.NewInternalServerError("Error getting user email from external provider")
}
...
flowState.ProviderAccessToken = providerAccessToken   // PKCE: auth.flow_state に一時保存
...
case models.CreateAccount:
	if config.DisableSignup { return ... "Signups not allowed for this instance" }
```
- `token.go` の PKCE グラントで `token.ProviderAccessToken = flowState.ProviderAccessToken` を返し、その後 flow_state を削除。
- つまり custom provider 方式では「サインアップ許可」が必要、`email_optional: true` が必要、provider access token は交換完了まで auth スキーマに平文で残る。

Foursquare 側の互換性(未検証・要実地確認):
- 公式 v2 認証ドキュメントは `Authorization: Bearer <ACCESS_TOKEN>` を案内(https://docs.foursquare.com/developer/reference/v2-authentication)。一方 golang/oauth2#252(2017)では Bearer が `invalid_auth` で `oauth_token` クエリだと成功したという報告。現行挙動は不明。
- トークンエンドポイント `https://foursquare.com/oauth2/access_token` のレスポンスは `{ "access_token": ... }` のみ(token_type/expires_in 無し)。golang oauth2 は token_type 空なら Bearer 扱いなので許容されるはず(推測)。POST/Basic 認証の受理可否は未確認。
- PKCE パラメータ(code_challenge/code_verifier)を Foursquare が無視するか拒否するかは不明 → `pkce_enabled: false` が無難(推測)。
- v2 API は `v=YYYYMMDD` 必須 → userinfo_url にクエリで付けられるが、どのみちネスト構造なのでアダプタが必要。

アダプタ案(参考。採用は非推奨):
```ts
// app/api/oauth/foursquare-userinfo/route.ts  (Supabase Auth サーバーから呼ばれる)
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return new Response('unauthorized', { status: 401 })
  const r = await fetch(`https://api.foursquare.com/v2/users/self?v=20261016&oauth_token=${encodeURIComponent(token)}`)
  if (!r.ok) return new Response('upstream error', { status: 401 })
  const u = (await r.json()).response.user
  return Response.json({ sub: String(u.id), name: [u.firstName, u.lastName].filter(Boolean).join(' '),
                         picture: u.photo ? `${u.photo.prefix}100x100${u.photo.suffix}` : undefined })
}
```
問題点: `exchangeCodeForSession` の戻り session に `provider_token` が含まれ、@supabase/ssr がそのまま Cookie に保存する(下記実験 Test1/Test4)→ N-02「クライアントに一切送出しない」に反する。回避するなら交換直後に `setSession({access_token, refresh_token})` で Cookie を上書きする等のハックが必要(未検証)。

---

## 3. 調査項目2: サーバー側セッション発行方式の比較

### 3.1 レート制限(公式表 + shared-data/config.ts の既定値)

| 操作 | パス | 単位 | 変更可 | 既定 |
|---|---|---|---|---|
| メール送信 | 全メール送信系 | プロジェクト | カスタムSMTP/Send Email Hook | 内蔵SMTPは 2通/時 |
| サインアップ/サインイン | /signup /recover /resend /magiclink /otp /user(PUT) | IP | 可 | 30回/5分(バースト30)、匿名除く |
| OTP/マジックリンク送信 | /otp | ユーザー | 可 | 60秒に1回 |
| 検証 | /verify | IP | 可 | **30回/5分(バースト30)** |
| トークン | /token | IP | 可 | **150回/5分(バースト30)**(password, refresh, id_token, pkce 共通) |
| MFA | /factors/:id/challenge, verify | IP | 不可 | 15回/分(バースト30) |
| 匿名サインイン | /signup(email/phone 無し) | IP | 可 | 30回/時 |
| Web3 | /token | IP | 可 | 30回/5分 |

- 出典: https://supabase.com/docs/guides/auth/rate-limits (表は `_partials/auth_rate_limits.mdx`、値は `packages/shared-data/config.ts`)。
- 変更方法: ダッシュボード Authentication > Rate Limits、または Management API `PATCH /v1/projects/{ref}/config/auth` に `rate_limit_verify`, `rate_limit_token_refresh`, `rate_limit_otp`, `rate_limit_anonymous_users`, `rate_limit_email_sent` 等。
- ローカル: config.toml `[auth.rate_limit]` に `token_refresh = 150`, `sign_in_sign_ups = 30`, `token_verifications = 30` 等(ホストと同値)。
- **admin エンドポイント(/admin/users, /admin/generate_link)には IP レート制限ミドルウェアが付いていない**(`internal/api/api.go` のルーティング)。GET /user(getUser)にも無い(PUT /user のみ)。

### 3.2 IP アドレス転送(Sb-Forwarded-For)
公式(rate-limits.mdx)原文抜粋:
> To use a forwarded IP address for rate limiting in Supabase Auth, set the `Sb-Forwarded-For` header to the end-user IP address and make a request with a secret API key. Publishable API keys and legacy `anon`/`service_role` API keys are not supported.
> IP address forwarding must be explicitly enabled for new projects. (… Authentication > Rate Limits の IP Address Forwarding、または Management API `"security_sb_forwarded_for_enabled": true`)

公式サンプル:
```ts
const supabase = createServerClient('https://<your-project-id>.supabase.co', '<your-secret-key>', {
  global: { headers: { 'sb-forwarded-for': request.headers.get('x-forwarded-for') } },
})
```
ソース(`internal/sbff/sbff.go`, `internal/api/middleware.go`): 有効時、ヘッダ値の**左端**を `net.ParseIP` できればその IP をレート制限キーに使う(`performRateLimiting` が `/verify`、`/token` 等の全 limiter で使用)。Auth サーバー自体は鍵種別を見ていない → 「secret key のみ」の制約は API ゲートウェイ側で担保されていると推測。
注意(推測): `x-forwarded-for` の左端はプラットフォームによってはクライアントが偽装可能。Netlify は `x-nf-client-connection-ip` が保証ヘッダ(Netlify スタッフ回答)、Cloudflare は `cf-connecting-ip` を使うべき。

実験 Test6: `createServerClient(URL, SECRET, { global: { headers: { 'sb-forwarded-for': '203.0.113.7' } } })` で `verifyOtp` → `/auth/v1/verify` に `apikey: sb_secret_…` と `sb-forwarded-for: 203.0.113.7` が付くことを確認。

### 3.3 方式比較

| 方式 | 概要 | 主な利点 | 主な問題 | 評価 |
|---|---|---|---|---|
| (a) createUser + generateLink(magiclink) + verifyOtp(token_hash) | 公開 API の組み合わせ。公式に「generateLink() handles the creation of the user for signup, invite and magiclink」「TokenHash … can be used for the PKCE flow for Server Side Auth」 | 正規の Supabase セッション(refresh token あり、auth.sessions 行あり、signOut/getUser/getClaims すべて通常通り)。メール送信なし。Email プロバイダ無効・サインアップ無効でも動く見込み(ソース) | /verify の IP 制限(30/5分)。単一ページの公式チュートリアルは無い(コミュニティ実例: discussion #19320、Medium 記事)。同一ユーザー同時ログイン時に one-time token が上書きされ片方失敗 | **推奨** |
| (b) サーバーだけが知るパスワードで signInWithPassword | 例: HMAC(K, user_id) | 実装が単純 | `/token?grant_type=password` は **Email プロバイダ有効が必須**(token.go `Email logins are disabled`)→ /otp, /recover 等も開く。ユーザー自身が PUT /user でパスワード変更するとサーバーログインが壊れる(secure_password_change 既定 false)。K 漏洩で全アカウント乗っ取り。/token 制限を refresh と共有 | 非推奨 |
| (c) 自前 JWT 署名 | 署名鍵をインポート(`supabase gen signing-key --algorithm ES256` → standby として登録 → rotate)して `role: authenticated` の JWT を発行 | Data API は受け付ける(公式 FAQ に手順あり) | 非対称鍵移行後は Supabase の秘密鍵は抽出不可、自前鍵を import して current にする必要。refresh token・auth.sessions が無く @supabase/ssr のセッション管理が使えない。公式に「getClaims() は Supabase Auth 発行 JWT 専用。自前 JWT は検証失敗しうる」 | 非推奨 |
| (d1) Anonymous sign-in + linkIdentity | 匿名ユーザー作成後に OAuth ID をリンク | — | Foursquare をリンクするには結局 custom provider が必要。匿名サインインは 30回/時/IP。手動リンク有効化が必要 | 非推奨 |
| (d2) Third-party Auth(Custom OIDC) | アプリ自身を OIDC 発行者にして JWKS 公開、Supabase に信頼させる | auth.users 不要 | 発行者 URL は HTTPS 必須、非対称鍵+kid、`role` クレーム必須、**CLI 非対応**("Custom OIDC providers are not available in the Supabase CLI")、auth.uid() は sub が UUID の時のみ、auth.users への FK 不可、セッション/リフレッシュを自前実装 | 非推奨 |
| (e) Custom OAuth2 provider(`custom:foursquare`) | Supabase の OAuth フローに乗せる | state/PKCE を Supabase が処理、auth.identities に正規登録 | §2.3 の通り userinfo アダプタ必須、provider_token が Cookie に入る、flow_state に平文一時保存、サインアップ許可が必要、2026年新機能で関連バグ Open、F-05 は別途 (a) が必要 | 代替案(将来) |

### 3.4 方式(a)の詳細(ソース確認結果)

`internal/api/mail.go` `adminGenerateLink`:
```go
params.Email, err = a.validateEmail(params.Email)   // 形式チェックのみ
...
user, err := models.FindUserByEmailAndAudience(db, params.Email, aud)
if models.IsNotFoundError(err) {
	switch params.Type {
	case mail.MagicLinkVerification:
		params.Type = mail.SignupVerification       // 未登録なら signup に変換し
		params.Password, err = password.Generate(64, 10, 1, false, true)  // ランダムパスワードで作成
	...
case mail.MagicLinkVerification, mail.RecoveryVerification:
	user.RecoveryToken = hashedToken
	...
	terr = models.CreateOneTimeToken(tx, user.ID, user.GetEmail(), user.RecoveryToken, models.RecoveryToken, ...)
...
resp := GenerateLinkResponse{ User: *user, ActionLink: url, EmailOtp: otp, HashedToken: hashedToken,
                              VerificationType: params.Type, RedirectTo: referrer }
return sendJSON(w, http.StatusOK, resp)      // ← mailer.Send は呼ばない
```
- メール送信処理は無い(リンク URL を組み立てるだけ)。Send Email Hook も呼ばれない。
- `validateEmail`:
```go
func (a *API) validateEmail(email string) (string, error) {
	if email == "" { ... "An email address is required" }
	if len(email) > 255 { ... "An email address is too long" }
	if err := checkmail.ValidateFormat(email); err != nil { ... }   // github.com/badoux/checkmail (2017版)
	return strings.ToLower(email), nil
}
```
- MX/DNS チェックは `internal/mailer/validateclient/validateclient.go` の **mail クライアントのラッパー**(`emailValidatorMailClient.Mail()`)でのみ実施。`.test/.example/.invalid/.local/.localhost` サフィックスや `example.com`, `test.com` 等をブロックし、MX/A レコードを引くが、**メール送信時にしか動かない**(かつ `GOTRUE_MAILER_EMAIL_VALIDATION_EXTENDED` 等が有効な場合のみ)。
- 正規表現の JS 近似テスト(`exp-scripts/checkmail-test.cjs`):
```text
fsq_12345@example.invalid                FORMAT_OK
u_7f3c9a2b@users.noreply.example.com     FORMAT_OK
fsq-12345@swarm-search.local             FORMAT_OK
not-an-email                             FORMAT_NG
a@b                                      FORMAT_OK
```
- admin createUser(`internal/api/admin.go` `adminUserCreate`): `validateEmail` → 重複チェック → パスワード未指定なら 64文字ランダム生成 → `app_metadata = {provider:"email", providers:["email"]}` に `params.AppMetaData` をマージ → `email_confirm` なら confirm。`id`(UUID)指定も可。`DisableSignup` は見ない。
- `DisableSignup` を参照するのは公開 `/signup`、匿名サインイン、外部 OAuth のアカウント作成のみ(grep 結果)。
- Email プロバイダ無効(`External.Email.Enabled=false`)を見るのは `requireEmailProvider`(/recover)と `/token` の password グラント等。`/verify` と `/admin/*` には無い。
  - CLI の `[auth.email] enable_signup` が `ExternalEmailEnabled`(=Email プロバイダ有効/無効)にマップされる(apps/cli-go/pkg/config/auth.go)。紛らわしいので注意。
- `/verify` POST(`verify.go` `verifyPost`)は token_hash で one-time token を検索し、`type: 'email'` なら confirmation/recovery の両方を探して magiclink/signup を自動判別 → `issueRefreshToken` でセッション発行 → JSON 返却。auth-js の JSDoc: email の場合 `signup` と `magiclink` type は deprecated、`email` を使う。
- 万一メール送信が誘発されても(第三者が公開 /otp 等を叩く等)、内蔵 SMTP は「Unless you configure a custom SMTP server for your project, Supabase Auth will refuse to deliver messages to addresses that are not part of the project's team」(auth-smtp.mdx)→ 合成アドレス宛は "Email address not authorized" で送られない。将来カスタム SMTP を入れる場合は、合成アドレスのドメインを自前ドメイン(Null MX = RFC 7505 `MX 0 .`)にしておくとバウンス/第三者配送を防げる(推測を含む推奨)。`.invalid` は Supabase の拡張検証ブロックリストに入っているため、将来検証箇所が増えた場合に壊れるリスクがある(推測)。
- `CreateOneTimeToken` は同種トークンを `ClearOneTimeTokenForUser` で消してから作成 → 同一ユーザーで generateLink が並行すると先行分の verify が "Email link is invalid or has expired" になる → 1回リトライで吸収。
- OTP 有効期限(Mailer OtpExp、既定 3600秒)はメールOTP全体に効く設定。サーバーで即消費するので短くしてよい(Management API `mailer_otp_exp`、CLI `[auth.email] otp_expiry`)。

### 3.5 メタデータの扱い
- 公式(users.mdx): user_metadata は "editable by the user without any checks"。RLS や認可に使ってはいけない。
- 公式(row-level-security.mdx): `raw_user_meta_data` は `supabase.auth.update()` でユーザーが更新可能、`raw_app_meta_data` はユーザーが更新不可で認可データ向き。JWT は更新まで古い値。Cookie 4096 バイト制限に注意。
- 本アプリでは: fsq_user_id の正は `foursquare_accounts.fsq_user_id`(unique)に置き、ログイン時の照合は secret key でこのテーブルを引く。app_metadata に入れるのは「JWT に載せたい場合のみ」(秘密ではない)。表示名・アイコンは user_metadata ではなく自前テーブル推奨(JWT/Cookie 肥大化と改ざん可能性のため)。
- ユーザーは自分のアクセストークン(httpOnly でも DevTools で見える)と公開の publishable key で Auth API(PUT /user)を直接叩ける前提で設計する。

---

## 4. 調査項目3: @supabase/ssr と Next.js App Router(15/16)

### 4.1 公式の構成(supabase/supabase examples/auth/nextjs、2026-10 時点)
`lib/supabase/server.ts`:
```ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(cookiesToSet, _headers) {
        try { cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) }
        catch { /* Server Component から呼ばれた場合。proxy が更新するので無視可 */ }
      },
    },
  })
}
```
`lib/supabase/proxy.ts`(抜粋):
```ts
let supabaseResponse = NextResponse.next({ request })
const supabase = createServerClient(URL, PUBLISHABLE_KEY, { cookies: {
  getAll() { return request.cookies.getAll() },
  setAll(cookiesToSet, headers) {
    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
    supabaseResponse = NextResponse.next({ request })
    cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
    Object.entries(headers).forEach(([key, value]) => supabaseResponse.headers.set(key, value))
  } } })
// createServerClient と getClaims() の間にコードを書かない
const { data } = await supabase.auth.getClaims()
...
return supabaseResponse   // 必ずこれを返す(別レスポンスにするなら cookie と cache ヘッダをコピー)
```
`proxy.ts`: `export async function proxy(request) { return await updateSession(request) }` + 静的ファイル除外 matcher。
公式注記: 「Next.js 15 以前では proxy.ts は呼ばれない。16 で改名。それ以前は middleware.ts / `export async function middleware`」。

- `setAll(cookies, headers)` の第2引数(@supabase/ssr v0.10.0〜)は `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0` / `Expires: 0` / `Pragma: no-cache`。CDN キャッシュでセッション漏洩しないよう必ずレスポンスに付ける。
- 公式: 「Never trust `supabase.auth.getSession()` inside server code」。
- Next.js 16 proxy: Node.js ランタイム既定、`runtime` 設定不可。Server Functions は proxy のチェーン上の独立ルートではないので「各 Server Function 内で認証/認可を再確認」(Next.js 公式)。
- Next.js cookies(): set/delete は Server Function(Server Action)と Route Handler のみ。Server Component では不可。
- Server Actions は POST のみ + Origin と Host の比較で CSRF 保護(Next.js data-security ガイド)。Route Handler は自前で Origin 検証が必要。

### 4.2 getClaims / getUser / getSession(公式 `_partials/auth_methods.mdx` + auth-js 実装)
- getClaims: Cookie のアクセストークンを検証。非対称鍵(新規プロジェクトの既定)なら WebCrypto + JWKS(`/auth/v1/.well-known/jwks.json`、auth-js はモジュールグローバルに 10分キャッシュ)でローカル検証。HS 系なら getUser にフォールバック。期限 90秒前を切っていれば先に refresh。
- getUser: Auth サーバーに問い合わせ。**セッションが削除済み(signOut 後)なら `session_not_found`(403)**(auth.go `maybeLoadUserOrSession`)。
- advanced-guide 原文: "The only way to detect that a session ended server-side … is to fetch the user with `getUser()`. `getClaims()` verifies the token's signature and expiry … but an unexpired token stays valid even when the session behind it was revoked."
- 使い分け案: 通常ページ/検索 API は getClaims、連携解除・アカウント削除・端末一覧の失効など重要操作は getUser(または JWT の session_id が auth.sessions に存在するか確認)。
- ローカル CLI は `signing_keys_path` 未設定だと HS256(既定 jwt_secret "super-secret-jwt-token-with-at-least-32-characters-long")→ getClaims が毎回 getUser にフォールバック。本番と揃えるなら `supabase gen signing-key --algorithm ES256` → `[auth] signing_keys_path`。

実験 Test2(ES256 で署名した JWT を Cookie に入れて getClaims): 発生した HTTP は JWKS 取得 1回のみ。
```text
=== Test2 getClaims error: null  sub: 11111111-2222-3333-4444-555555555555
=== Test2 HTTP calls made by getClaims: [{"method":"GET","url":"/auth/v1/.well-known/jwks.json", ...}]
```

### 4.3 httpOnly Cookie とブラウザクライアント不使用
- 公式 sessions.mdx「Using HTTP-only cookies to store access and refresh tokens」: "This is possible, but only for apps that use the traditional server-only web app approach where all of the application logic is implemented on the server and it returns rendered HTML only. … the Supabase JavaScript libraries provide only limited support."
- 公式 advanced-guide FAQ「How do I make the cookies HttpOnly?」: "This is not necessary. … The browser-based side of your application needs access to the refresh token to properly maintain a browser session anyway."
- @supabase/ssr の既定: `DEFAULT_COOKIE_OPTIONS = { path: "/", sameSite: "lax", httpOnly: false, maxAge: 400日 }`。`cookieOptions` は既定に上書きマージされる(maxAge だけは常に既定値で上書き)。
- 実験 Test1(`cookieOptions: { httpOnly: true, secure: true, sameSite: 'lax', path: '/' }` で verifyOtp):
```text
"name": "sb-abcdefghijklmnopqrst-auth-token", "len": 1714,
"options": { "path": "/", "sameSite": "lax", "httpOnly": true, "maxAge": 34560000, "secure": true }
headers: Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0 / Expires: 0 / Pragma: no-cache
```
- 実験 Test1 の追加結果: verify レスポンスに `provider_token` を含めると(PKCE 交換と同じ `_sessionResponse` → `_saveSession` 経路)、Cookie の JSON に `provider_token` がそのまま入る:
```text
=== Test1 cookie contains provider_token?: true
=== Test1 cookie top-level keys: [ 'access_token','token_type','expires_in','expires_at','refresh_token','user','provider_token' ]
```
- 実験 Test4(`cookies.encode: 'tokens-only'`、@experimental): user オブジェクトは Cookie から除かれる(1280→893文字)が provider_token は残る。
- 結論: 本アプリは「検索・ページネーション・同期をすべてサーバー側」で完結するので httpOnly 構成は成立する。代償は Realtime やブラウザ直 PostgREST が使えないこと(MVP では不要)。`secure` は本番のみ true(localhost 開発時は要確認)。

### 4.4 推奨クライアント構成(設計スケッチ・未実行)
```ts
// lib/supabase/server.ts — ユーザー権限(RLS 適用)。publishable key。httpOnly。
import 'server-only'
export async function createUserClient() {
  const cookieStore = await cookies()
  return createServerClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' },
    cookies: { getAll: () => cookieStore.getAll(),
               setAll: (cs) => { try { cs.forEach(({ name, value, options }) => cookieStore.set(name, value, options)) } catch {} } },
  })
}

// lib/supabase/admin.ts — secret key。Cookie 非連携。auth.admin.* と RLS をまたぐ処理専用。
import 'server-only'
export function createAdminClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

// lib/auth/issue-session.ts — 方式(a)。secret key クライアントは Cookie に触れさせない。
export async function issueSession(email: string, clientIp: string | null) {
  const admin = createAdminClient()
  const { data: link, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw error
  // verify は secret key + Sb-Forwarded-For(有効化している場合)で。セッションはメモリにだけ載る。
  const verifier = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: clientIp ? { 'sb-forwarded-for': clientIp } : {} },
  })
  const { data, error: vErr } = await verifier.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' })
  if (vErr || !data.session) throw vErr ?? new Error('no session')
  // Cookie 書き込みはユーザー権限クライアントで(setSession は GET /user を1回呼ぶ。GET /user は IP 制限なし)
  const userClient = await createUserClient()
  const { error: sErr } = await userClient.auth.setSession({
    access_token: data.session.access_token, refresh_token: data.session.refresh_token })
  if (sErr) throw sErr
}
```
- 実験 Test7(上記の分離構成をモック fetch で実行): `/auth/v1/verify` は `apikey: sb_secret_…` + `sb-forwarded-for: 198.51.100.23` で送信、続いて `GET /auth/v1/user` が publishable key + ユーザー JWT で1回、Cookie は httpOnly/secure で1つ発行、Cookie 内キーは access_token/refresh_token/user/token_type/expires_in/expires_at のみ(**provider_token が仮に verify 応答に含まれていても setSession 経由なら Cookie に入らない**)。
- 代替: 公式サンプル通り「secret key + Cookie 連携」の createServerClient で直接 verifyOtp してもよいが、その場合そのクライアントを**データ取得に流用しない**(§6)。
- proxy の refresh(/token)は publishable key クライアントでサーバー IP 計上(150/5分/IP)。必要なら `rate_limit_token_refresh` を引き上げる(Email プロバイダ無効なら password グラントが無いので引き上げの副作用は小さい — 推測)。

### 4.5 Route Handler でのフロー(初回ログイン、設計スケッチ)
1. `GET /auth/foursquare/start`: ランダム state を `__Host-fsq_state`(httpOnly, Secure, SameSite=Lax, 10分)に保存し `https://foursquare.com/oauth2/authenticate?client_id=…&response_type=code&redirect_uri=…&state=…` へ 302。
2. `GET /auth/foursquare/callback?code&state`: state 照合(N-08)→ Cookie 削除 → `https://foursquare.com/oauth2/access_token` でコード交換 → `GET /v2/users/self?v=…` で fsq_user_id 取得。
3. admin クライアントで `foursquare_accounts` を fsq_user_id で検索。無ければ `auth.admin.createUser({ email: 'u_<random>@<自ドメインのサブドメイン>', email_confirm: true, app_metadata: { fsq_user_id } })` → `foursquare_accounts` に insert(unique 違反時は再読込)。
4. access_token を暗号化保存(Vault 等。N-02)。
5. `issueSession(email, clientIp)`(§4.4)。
6. 端末記憶トークン発行(§9)。
7. 同期画面へ 302(レスポンスに no-store)。

---

## 5. 調査項目4: 新 API キー体系

- 公式 api-keys.mdx:
  - 種類: Publishable `sb_publishable_...`(低権限、公開可)/ Secret `sb_secret_...`(昇格、RLS バイパス、バックエンド専用)/ legacy `anon`・`service_role`(長寿命 JWT)。
  - 「Publishable and secret keys are short strings, not JWTs.」
  - 「A secret key doesn't work in a browser. Supabase matches on the `User-Agent` header and returns HTTP 401 Unauthorized.」
  - キー → ロール: publishable(未ログイン)= anon、publishable(ログイン済み)= authenticated、secret = service_role。
  - 推奨 .env:
```bash
# Safe to expose to the browser. Prefix per your framework.
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
# Server-only. Never prefix these, or your bundler will ship the key.
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
```
  - 既知の制限: キーは `apikey` ヘッダで送る(JWT として検証しようとすると失敗)。
- 廃止スケジュール: docs 部分テンプレート「Supabase is deprecating the `anon` and `service_role` keys by the end of 2026.」。discussion #29260: 2025-06 早期提供、2025-07 正式、**2025-11 以降の新規プロジェクトには anon/service_role が無い**、「Late 2026 (TBC): Legacy API keys will be deleted」。
- 新キー作成はレガシーを失効させない(併用可、レガシーは Settings > API Keys で無効化、再有効化可)。
- ローカル CLI: `supabase start`/`status` の "Authentication Keys" に Publishable / Secret を表示。`supabase status -o env` の変数名(apps/cli-go/internal/status/status.go): `API_URL`, `PUBLISHABLE_KEY`, `SECRET_KEY`, 非推奨扱いで `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` も出力。ローカル既定値は固定(apikeys.go: `sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH`, `sb_secret_N7UND0UgjKTVK-Uodkm0Hg_xSvEMPvz`)。
- supabase-js 2.118 は `sb_publishable_`/`sb_secret_` を認識し、Edge Functions 呼び出し時は Bearer に載せない(functionsFetch)。PostgREST 等の通常 fetch では セッション無し時に `Authorization: Bearer <key>` を付ける(実験 Test3)。
- 要件 L-03 の「anon key・service role key」は「publishable key・secret key」に読み替えが必要(2026年10月時点で新規プロジェクトにはレガシーキーが無い)。
- 本アプリは httpOnly + サーバー専用構成なので publishable key もブラウザに出す必要がない → `NEXT_PUBLIC_` を付けずサーバー専用 env に置いてもよい(公開されても問題ない値ではある)。

---

## 6. 調査項目5: secret key(service role)クライアントの注意

- 公式 RLS ドキュメント: "A secret key bypasses RLS only when the request carries no user access token. If the request carries one, it runs under the RLS policies of that signed-in user, even when the client library was initialized with a secret key."
- 公式トラブルシュート: "RLS in enforced based on the `Authorization` header and not the `apikey` header." / "If you are using SSR, always create a separate server client using supabase-js directly for service role." / signUp 等を service role クライアントで呼ぶとセッションが入り Authorization が置き換わる → ユーザー作成は admin.createUser。
- 公式 Admin API リファレンス: admin 系は secret key 必須、`createClient(url, secret_key, { auth: { autoRefreshToken: false, persistSession: false } })`。
- 実験 Test3(REST リクエストのヘッダ):
```text
admin(no session)            : apikey sb_secret_…  Authorization: Bearer sb_secret_…        → service_role
secret+cookies(session あり) : apikey sb_secret_…  Authorization: Bearer eyJhbGciOiJFUzI1…  → ユーザーの RLS
secret+cookies(session なし) : apikey sb_secret_…  Authorization: Bearer sb_secret_…        → service_role(黙って昇格)
publishable(no session)      : apikey sb_publishable_…  Authorization: Bearer sb_publishable_… → anon
```
- 推奨ルール: (1) secret key クライアントは Cookie 非連携・per-request 生成・`import 'server-only'`、(2) secret key を使うコードを `lib/supabase/admin.ts` と認証発行モジュールに限定、(3) secret key クライアントで signIn*/verifyOtp を呼んだら即破棄(データ取得に流用しない)、(4) secret key はバックエンドコンポーネントごとに分けて発行(漏洩時の個別ローテーション)、(5) ログに出さない。
- Vercel Fluid compute 等でモジュールスコープのクライアント共有は禁止(公式 advanced-guide)。

---

## 7. 調査項目6: signOut の scope / セッション失効 / ユーザー削除

- 公式 signout.mdx: `global`(既定、JS)/ `local` / `others`。「With the `global` scope, calling `signOut()` on one device revokes the refresh tokens for every session that user has」。「Access Tokens of revoked sessions remain valid until their expiry time」。
- ソース(logout.go / sessions.go): global = `DELETE FROM auth.sessions WHERE user_id = ?`、local = `WHERE id = <session_id>`、others = `WHERE id != ? AND user_id = ?`。refresh token は session に紐づくため失効。
- auth-js `_signOut`: 404/401/403 は無視してローカルセッションを削除。`others` ではローカルを消さない。実験 Test5: `signOut({scope:'local'})` → `POST /auth/v1/logout?scope=local`(ユーザー JWT)→ Cookie を `maxAge: 0` で削除。
- 公式 advanced-guide: スコープ無し signOut はデフォルト global なので SSR では他端末も落ちる → 端末ごとに独立させたいなら `local` を明示。
- サーバー側で特定 JWT のセッションを切るなら `auth.admin.signOut(jwt, scope)`。
- アクセストークン失効を即時に効かせたい操作は、JWT の `session_id` が `auth.sessions` に存在するかを確認(公式 sessions.mdx)。
- 公式 managing-user-data.mdx:
  - 自前テーブルは `references auth.users on delete cascade` を推奨。
  - `auth.admin.deleteUser()`(既定 `shouldSoftDelete: false`)で auth.users 行を削除 → auth.sessions へ cascade → refresh token 無効。発行済みアクセストークンは exp まで有効。
  - Storage オブジェクトの所有者は削除不可(本アプリは Storage 未使用)。
- 公式トラブルシュート(Dashboard errors when managing users): "Database error deleting user" の原因 = auth.users へのトリガー(`supabase_auth_admin` は最小権限なので auth スキーマ外を触ると権限エラー)/ 満たせない FK 制約 → CASCADE か SET NULL に。
- 設計上の注意(一部推測):
  - `checkins` が数万行のユーザーを `deleteUser` すると、GoTrue の削除トランザクション内で cascade 削除が走る → タイムアウトの恐れ(推測)。F-42 のバッチで先に checkins をチャンク削除してから deleteUser を呼ぶ。
  - Vault の `vault.secrets` はユーザーと FK で結ばれない → ユーザー/連携削除時に明示削除(削除フローの中で secret_id を消す。トリガーにするなら SECURITY DEFINER + `search_path` 固定、ローカルで要検証)。
  - `shouldSoftDelete: true` は auth.users 行を残す(cascade は発火しない)。
  - 連携解除(F-03/F-40)は auth ユーザーを消さない(再連携で同じ fsq_user_id → 同じ user_id に復元するため)。猶予期間満了バッチ(F-42)で checkins 物理削除 → 必要なら auth ユーザーも削除(データ最小化)。
  - 連携解除時は `signOut global` 相当(全セッション削除)+ 端末記憶トークン全失効 + Foursquare トークン削除を同一処理で。

---

## 8. その他の設計影響事項

- **Node 22+ 必須**(§1)。Netlify Functions / ローカル / CI のランタイムを Node 22 以上に。
- **Next.js 16 proxy.ts とホスティング**:
  - Cloudflare + OpenNext: Node.js middleware(=Next 16 proxy.ts)対応 PR #1309 は 2026-08-25 マージ。`nodejs_compat` 必須、警告ログが出る実験機能、メンテナは「サポートするつもりはない」と発言。issue #1400(@opentelemetry/api があるとビルド失敗)など未解決事項あり。
  - Netlify: proxy.ts の公式対応状況は今回確認できず(standalone ビルドで proxy.js の ENOENT という個別報告あり)。→ ホスティング調査で要確認。
  - proxy が使えない場合の退避策: Next 16 でも非推奨の `middleware.ts` は動作する(Edge ランタイム)。@supabase/ssr は Edge でも動作(推測、公式例は環境非依存の cookie アダプタ)。
- refresh token 再利用検知: 既定 10秒の再利用猶予。proxy と Server Component の二重 refresh はランダムなサインアウトの原因(公式 creating-a-client「Why does refreshing in two places sign users out?」)→ refresh は proxy に一本化。
- Supabase セッションの期限管理(Time-box / Inactivity timeout / Single session)は Pro 以上。

---

## 9. 調査項目7: F-05(再ログインで OAuth 不要)を安全に実現する方式案

### 9.1 前提
ログアウト後のブラウザには Supabase セッションが無い。「誰が再ログインしようとしているか」をサーバーが知る手段が別途必要 → 端末に紐づく長期資格情報(remember-device token)が必須。これは「その端末を持つ人は Foursquare 認証なしでログインできる」ことと同義なので、要件として明示的に受け入れる必要がある。

### 9.2 方式案(推奨)
テーブル(案):
```sql
create table public.device_logins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash bytea not null unique,            -- sha256(32バイト乱数)。平文は保存しない
  prev_token_hash bytea,                       -- ローテーション直前の値(短い猶予用)
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null,             -- 例: 最終利用から30日、絶対上限180日
  revoked_at timestamptz,
  user_agent text                              -- 端末一覧表示用(短く切る)
);
alter table public.device_logins enable row level security;
-- authenticated には token_hash を見せない(一覧は security definer 関数かビューで必要列のみ)
```
Cookie: `__Host-ss_device=<base64url(32 bytes)>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=30日`。

フロー:
1. 初回(Foursquare OAuth 成功時)に端末トークン発行。
2. ログアウト(F-05): `signOut({ scope: 'local' })` で Supabase セッションのみ終了。端末トークンと Foursquare トークンは保持。UI で「この端末の記憶も消す」を選べるようにする(選んだ場合は device_logins 行を revoke し Cookie 削除)。
3. 再ログイン `POST /auth/resume`(Server Action 推奨: Origin/Host 照合の CSRF 保護あり)
   1. IP/端末単位のレート制限。
   2. Cookie → sha256 → device_logins 検索(未失効・未期限切れ)。`prev_token_hash` で一致し猶予(例60秒)外なら盗用疑い → その user の全端末トークンを失効し OAuth へ。
   3. 保存済み Foursquare トークンを復号(サーバーのみ)→ `GET /v2/users/self` で有効性と fsq_user_id 一致を確認。401 なら F-14 の再連携導線へ。
   4. 方式(a)で Supabase セッション発行(§4.4)。
   5. 端末トークンをローテーション(新トークンの hash に更新、旧 hash を prev に)、Cookie 再発行、last_used_at/expires_at 更新。
   6. 差分同期(F-12)を起動。
4. 「全端末からログアウト」: `signOut({ scope: 'global' })` + device_logins 全失効。
5. 連携解除(F-03): Foursquare トークン削除 + device_logins 全削除 + 全セッション削除。
6. マイページ(F-04)に端末一覧と個別失効。

### 9.3 リスクと緩和
| リスク | 内容 | 緩和策 |
|---|---|---|
| 共有端末 | ログアウトしても同じブラウザから誰でも再開できる | 自動再開はしない(明示ボタン)。ログアウト時に「端末の記憶も消す」選択肢。期限を短め(30日スライディング)。ログイン画面で個人情報を出さない(表示名の頭文字程度) |
| 端末トークン窃取 | マルウェア/物理アクセス/バックアップ経由 | httpOnly + Secure + `__Host-` 接頭辞、毎回ローテーション + 再利用検知、端末一覧で失効、連携解除/削除で全失効、任意で UA 等の粗い一致チェック |
| DB 漏洩 | トークン表が漏れる | 乱数32バイトの sha256 のみ保存(可逆性なし)。必要ならサーバーペッパー付き HMAC |
| Foursquare トークンの長期保管 | ログアウト後も保持(F-05 の要求) | Vault 等で暗号化、復号はサーバーの secret key 経由の関数のみ、クライアントへ一切返さない(N-02)、再開時に有効性確認 |
| 再開エンドポイントの濫用 | セッション大量発行、/verify 制限の消費 | アプリ側レート制限、Sb-Forwarded-For、失敗回数での一時ロック |
| ログイン CSRF / セッション固定 | 他サイトから再開を誘発 | Server Action(Origin/Host 照合)または Route Handler で Origin 検証、SameSite=Lax、再開ごとに新セッション |
| 失効の遅延 | signOut 後もアクセストークンは exp まで有効 | 重要操作は getUser / session_id 確認、JWT 有効期限は既定1時間のまま |

### 9.4 代替案(要件側の再確認候補)
- Foursquare の `/oauth2/authenticate` が既承認ユーザーに同意画面を出さず即リダイレクトするなら、「OAuth 再実行はするがユーザー操作は不要」で端末記憶トークン無しにできる(よりシンプル・安全)。挙動は未確認 → 実地検証が必要。

---

## 10. 実地検証手順案(検証1)

前提: Node 22+、Docker Desktop(または互換ランタイム)導入、Supabase CLI 2.121+、Foursquare アプリ(開発用 redirect_uri 登録済み)。

1. ローカルスタック: `npx supabase init` → config.toml で `[auth] enable_signup = false`, `[auth.email] enable_signup = false`(=Email プロバイダ無効), `[auth.email] otp_expiry = 300`, 任意で `signing_keys_path`(ES256)→ `npx supabase start` → `npx supabase status -o env` の変数名を記録。
2. admin 経路の確認(Node スクリプト、secret key):
   - `auth.admin.createUser({ email: 'u_test@users.example.invalid', email_confirm: true, app_metadata: { fsq_user_id: '1' } })` が成功するか(`.invalid` と自ドメイン案の両方)。Mailpit(http://127.0.0.1:54324)にメールが届いていないこと。
   - `auth.admin.generateLink({ type: 'magiclink', email })` → `properties.hashed_token`, `verification_type` を記録。
   - `verifyOtp({ token_hash, type: 'email' })` でセッションが返るか(Email プロバイダ無効・サインアップ無効のままで)。
   - 未登録メールで generateLink(magiclink)した場合に verification_type が `signup` になりユーザーが作られることを確認。
   - 同一ユーザーで generateLink を2回 → 1回目の token_hash で verify が失敗することを確認(リトライ設計の根拠)。
3. レート制限: `/verify` を同一 IP から31回以上叩いて 429 を確認 → ホストプロジェクトで IP Address Forwarding を有効化し、secret key + `sb-forwarded-for` を変えて制限が分離されることを確認(publishable key では無視されることも確認)。
4. Next.js 16 試作: §4.4 の構成で callback/resume/logout を実装し、Cookie が httpOnly で発行されること、proxy の getClaims で更新されること、Server Component で getSession を使っていないことを確認。ブラウザ DevTools で `document.cookie` に sb-*-auth-token が見えないこと。
5. signOut: local/global の挙動(他ブラウザのセッションが残る/消える)、signOut 後の旧アクセストークンで getUser が `session_not_found`、getClaims は exp まで成功することを確認。
6. ユーザー削除: checkins 数万行(fixture)を持つユーザーで `deleteUser` の所要時間・成否を計測し、先行バッチ削除の要否を判断。Vault secret が残ることを確認。
7. (任意)custom provider 方式の可否: `customProviders.createProvider({ provider_type: 'oauth2', identifier: 'custom:foursquare', authorization_url: 'https://foursquare.com/oauth2/authenticate', token_url: 'https://foursquare.com/oauth2/access_token', userinfo_url: <アダプタURL>, email_optional: true, pkce_enabled: false, scopes: [] })` → ログインできるか、Cookie に provider_token が入るか。
8. Foursquare 実地: Bearer ヘッダで `/v2/users/self` が通るか、`oauth2/authenticate` が既承認ユーザーで同意画面をスキップするか、トークン交換が POST/Basic を受け付けるか。

---

## 11. オフライン実験(モック fetch)の全出力

- スクリプト: `exp-scripts/ssr-cookie-experiment.cjs`(引数に `exp-sb-auth` のパス。ネットワーク不使用。ES256 鍵を WebCrypto で生成して JWT を署名し、JWKS をモック応答)
- Node v20.11.1 のため `realtime: { transport: DummyWS }` を渡して RealtimeClient 初期化エラーを回避している(本番は Node 22+ にすること)。
- 出力(`exp-scripts/ssr-cookie-experiment.out.txt`):
```text
=== Test1 verifyOtp error: null
=== Test1 setAll calls: [{ "cookies": [{ "name": "sb-abcdefghijklmnopqrst-auth-token", "len": 1714,
      "options": { "path": "/", "sameSite": "lax", "httpOnly": true, "maxAge": 34560000, "secure": true } }],
    "headers": { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0", "Expires": "0", "Pragma": "no-cache" } }]
=== Test1 cookie names: [ 'sb-abcdefghijklmnopqrst-auth-token' ]
=== Test1 decoded cookie length: 1280
=== Test1 cookie contains provider_token?: true
=== Test1 cookie top-level keys: [ 'access_token','token_type','expires_in','expires_at','refresh_token','user','provider_token' ]
=== Test2 getClaims error: null  sub: 11111111-2222-3333-4444-555555555555
=== Test2 HTTP calls made by getClaims: [{"method":"GET","url":"/auth/v1/.well-known/jwks.json","apikey":"sb_publishable_TESTTESTTEST","authorization":"Bearer sb_publishable_TESTTESTTEST...","sbForwardedFor":null}]
=== Test3 REST calls [admin(no session), secret+cookies(session), secret+cookies(no session), publishable(no session)]:
  apikey sb_secret_…       / Authorization: Bearer sb_secret_…
  apikey sb_secret_…       / Authorization: Bearer eyJhbGciOiJFUzI1NiIsImtpZCI6InRlc…
  apikey sb_secret_…       / Authorization: Bearer sb_secret_…
  apikey sb_publishable_…  / Authorization: Bearer sb_publishable_…
=== Test4 tokens-only cookie names: [ 'sb-abcdefghijklmnopqrst-auth-token' ]  decoded length: 893  keys: [ 'access_token','token_type','expires_in','expires_at','refresh_token','provider_token' ]
=== Test4 tokens-only contains provider_token?: true
=== Test5 signOut error: null
=== Test5 HTTP calls: [{"method":"POST","url":"/auth/v1/logout?scope=local","apikey":"sb_publishable_TESTTESTTEST","authorization":"Bearer eyJ…"}]
=== Test5 setAll (cookie removal): [{"name":"sb-abcdefghijklmnopqrst-auth-token","len":0,"options":{"path":"/","sameSite":"lax","httpOnly":true,"maxAge":0,"secure":true}}] + cache headers
=== Test5 remaining cookies: []
=== Test6 verifyOtp error: null
=== Test6 HTTP calls: [{"method":"POST","url":"/auth/v1/verify","apikey":"sb_secret_TESTTESTTEST","authorization":"Bearer sb_secret_TESTTESTTEST...","sbForwardedFor":"203.0.113.7"}]
=== Test7 verify error: null  setSession error: null
=== Test7 HTTP calls: [{"method":"POST","url":"/auth/v1/verify","apikey":"sb_secret_…","sbForwardedFor":"198.51.100.23"},{"method":"GET","url":"/auth/v1/user","apikey":"sb_publishable_…","authorization":"Bearer eyJ…"}]
=== Test7 cookie options: [[{"name":"sb-abcdefghijklmnopqrst-auth-token","httpOnly":true,"secure":true}]]
=== Test7 cookie contains provider_token?: false  keys: [ 'access_token','refresh_token','user','token_type','expires_in','expires_at' ]
```
- 実験の限界: Supabase 側の挙動(ゲートウェイの鍵判定、レート制限、Email プロバイダ無効時の admin 経路)はモックなので検証していない。クライアントライブラリの挙動(どのヘッダを送るか、Cookie に何を保存するか)の確認に限る。

## 12. 参照ソース
- Supabase docs: custom-oauth-providers / self-hosted-custom-oauth-providers / rate-limits / server-side/creating-a-client / server-side/advanced-guide / sessions / signout / managing-user-data / users / database/postgres/row-level-security / getting-started/api-keys / getting-started/migrating-to-new-api-keys / signing-keys / jwts / third-party/overview / third-party/custom-oidc / passwords / reference/javascript/admin-api / troubleshooting(service role RLS, dashboard errors)
- Supabase GitHub: supabase/auth master(provider/custom_oauth.go, provider/provider.go, models/identity.go, models/one_time_token.go, models/sessions.go, api/api.go, api/middleware.go, api/auth.go, api/mail.go, api/admin.go, api/verify.go, api/token.go, api/external.go, api/logout.go, api/signup.go, sbff/sbff.go, mailer/validateclient/validateclient.go)、supabase/supabase examples/auth/nextjs、packages/shared-data/config.ts、supabase/cli develop(apps/cli-go/internal/status/status.go, pkg/config/templates/config.toml, pkg/config/templates/Dockerfile, pkg/config/apikeys.go, pkg/config/auth.go)
- Issues/Discussions: supabase/auth#2519, supabase discussions #29260 / #45715 / #19320 / #42047, supabase/auth#1357, golang/oauth2#252, opennextjs-cloudflare PR #1309 / issue #1400
- Next.js docs: file-conventions/proxy, functions/cookies, guides/data-security
- Foursquare docs: developer/reference/v2-authentication
- Netlify forum: Client IP header(x-nf-client-connection-ip)
