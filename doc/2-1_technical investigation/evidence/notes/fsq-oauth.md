# 調査メモ: Foursquare(Swarm) OAuth2・アカウント連携・API利用規約 (key: fsq-oauth)

- 調査日: 2026-10-16(JST)
- 対象要件: F-01〜F-05, F-14, N-04, N-08, N-09 / 着手事項 検証1(前半)・検証4・検証5
- 凡例: 【確認済】=公式ドキュメント記載 or 本調査での実測で確認 / 【間接】=第三者実装・旧ドキュメント等からの推定 / 【推測】=根拠が弱い推測 / 【未確認】=実アカウントが無いと確認不可
- 実測は「認証情報を一切使わない(ダミー値のみの)リクエスト」に限定。プロジェクトディレクトリは一切変更していない。
- 作業ファイル: `scratchpad\fsq-oauth-work\`(scripts\probe.ps1, downloads\ 以下に取得物)

---

## 0. TL;DR(設計に効く結論)

1. **v2 ユーザー系エンドポイントは 2026-10 時点で稼働・文書化されているが、それを含む "Personalization API" はドキュメント上 "Deprecated" 表示**(docs トップ、Developer Console 内リンク "(depr)")。サンセット日は未発表。料金面は「checkins / users 系エンドポイントは無料のまま」(2026-06-01 料金改定ページ、2026-10-05 更新)。
2. **OAuth は "Legacy" 扱いの OAuth2(認可コード)**: `https://foursquare.com/oauth2/authenticate` → `https://foursquare.com/oauth2/access_token`。レスポンスは `{"access_token": "..."}` のみ(文書)。**refresh_token グラントは非対応(実測で `unsupported_grant_type`)**、スコープなし、トークンは現状無期限(旧ドキュメント)。トークンエンドポイントは GET(クエリ)/POST(フォーム)のどちらでも 405 にならず OAuth エラー JSON を返す=両メソッドがハンドラに到達(実測。正規の資格情報での成功は未確認)。
3. **レガシー OAuth のトークン revoke エンドポイントは存在しない**(`/oauth2/revoke` `/oauth2/deauthorize` は存在しないパスと同じ 404 を返す。実測)。→ **N-09 は実現不可**、F-03 は「自DBから即削除+Foursquare側設定画面への案内」に読み替えが必要。
4. 2026-10 時点で **新しい OAuth 2.1 サーバ**(`https://api.foursquare.com/oauth21/*`: PKCE必須・スコープ・refresh_token・**revocation_endpoint あり**)が公開されている(公開時期は未特定)が、**client_id は "Client ID Metadata Document" の HTTPS URL 必須かつ「trusted domains list」に載ったドメインのみ**(実測エラー: `Client domain 'example.com' is not in the trusted domains list`)。Swarm MCP(Claude/ChatGPT 連携, Beta)用であり、一般のサードパーティWebアプリは使えない。
5. **エラー判定は HTTP ステータスではなく `meta.errorType` で行うこと**: トークン無し=HTTP 400 + `invalid_auth`、無効/取消済トークン=HTTP 401 + `invalid_auth`("OAuth token invalid or revoked.")(実測)。レート超過=403 `rate_limit_exceeded`、日次クォータ=429 `quota_exceeded`(文書)。2025-12 に `users/self/checkins` で **402 Payment Required** の報告あり。
6. レート制限: **OAuth トークンごと・1時間あたり・トップレベル資源グループごとに 500**(Users 500 / Checkins 500 等)。ヘッダ `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`。
7. 規約: **"Powered by Foursquare" の表示義務**(Personalization EULA §3.2)、**アプリ名・ドメインに "Swarm" "Foursquare" 等の商標を含めてはいけない**(Trademark Guidelines)、Personalization Data を表示するページのクロール防止(§3.3)、広告ネットワーク/データブローカーへの移転禁止(§6.2)、プライバシーポリシー URL 必須。**データ保持(キャッシュ)ルールは現行文書で不明瞭**(Places API の現行ガイドラインは PAYG で「キャッシュ不可」、旧ガイドラインは「30日」、Push API は「無期限キャッシュ禁止」)→ raw JSON 永続保存(F-13/N-06)は書面確認推奨。
8. 新規デベロッパー登録には審査(sanctions screening: "We are currently processing your application.")がある。**2026-10 時点で "新規" アカウント・新規プロジェクトで v2 OAuth + users/self/checkins が 402 等なしに使えるかは未確認**で、最初の実地スパイクで確認すべき最大のブロッカー。

---

## 1. 提供状況(2026-10 時点)

### 1.1 ドキュメント上の位置付け
- docs.foursquare.com トップの製品一覧(本調査で取得):
  - `Places API New!`、`Users API New!`
  - `Personalization API - Deprecated`(リンク先 /developer/reference/search, user-management, user-generated-content-overview, venues)
- 個別ページ(例: Get User Checkins)は今も "Public Beta Feature" 表記で、"Personalization API (Self-Service) Public Beta End User License Agreement" に従うと記載。
  - https://docs.foursquare.com/developer/reference/get-user-checkins
- Personalization API の認証ページ(updatedAt: 2026-02-12)では "O&O users are users of Foursquare's owned and operated apps; City Guide and Swarm." と、Swarm ユーザーが OAuth でログインできる対象であることを明記。
- v2 の OAuth ガイド(Using OAuth Authentication, updatedAt 2026-02-12)冒頭の Legacy notice:
  - "If you added Foursquare after 11/18/21, you automatically have access to the new version (v3) of the API."
  - "For those who are already using the current (v2) version of the API, you may continue to do so or elect to upgrade now."
  - → 2021-11-18 以降の新規利用者に v2 が使えるかは文面上あいまい。
- 新 Users API(fsq-developers-users)の Authentication には "3rd Party Authentication" として `https://app.foursquare.com/oauth2/authenticate` / `access_token` が載っているが、"Note: this is for enterprise customers only." と記載(Placemaker 用途)。
- Developer Console のバンドル(後述)では OAuth 欄のツールチップが `"Legacy Foursquare API uses OAuth to authenticate."`(別モードでは `"Used for 3rd Party Application Account Linking"`)、リソース欄に `"Get Started with the Personalization API (depr)"`。

### 1.2 稼働状況の根拠
- 本調査の実測: `GET https://api.foursquare.com/v2/users/self/checkins?v=20261016&limit=1&oauth_token=INVALIDTOKEN123` → HTTP 401 `{"meta":{"code":401,"errorType":"invalid_auth","errorDetail":"OAuth token invalid or revoked.",...}}`(エンドポイント自体は生きている)。
- 第三者の2026年の利用例:
  - shkspr.mobi(2026-06-02): OAuth アプリを作成し `users/self/checkins`, `checkins/{id}`, `checkins/add` を利用。"developers get 10,000 API calls for free each month" と記載(当時の pricing ページ表記)。
  - ericblue/swarm-downloader(v0.1: 2026-02-21): `response_type=token&redirect_uri=http://localhost` で取得。
  - mjanssen19/His-Story(2026): redirect URI `http://localhost:8765/callback` を登録する手順。
- 反証・リスク:
  - spokenlikeageek(2025-12-01): `users/self/checkins` で **`HTTP/1.1 402 Payment Required`**。サポートとのやり取りで「自分のデータ取得に課金されるべきでない」ことに同意を得たが解決まで約2か月。原因は記事中で不明。
  - tsu-nera/dailybuild#92(2026-08-28): 「新規アプリ登録が今も通るか(実際に登録していない)」を最大のブロッカーとして未確認扱い。

### 1.3 料金
- Upcoming Places API Changes(updatedAt 2026-10-05):
  - 2026-06-01 から新料金。Pro: 0〜500 calls $0.00 CPM、501〜100,000 $15.00 CPM …。"You will now receive **500** free Pro calls."
  - Pro tier の V2: `/v2/users/X/historysearch`, `/v2/venues/search`, `/v2/search/recommendations`, `/v2/venues/trending`, `/v2/venues/X/related`
  - Premium tier の V2: `/v2/venues/X` とそのサブパス(photos, tips, hours, menu, links, events, attributes)
  - **"Any checkins, lists, tastes, tips, and users endpoints not mentioned in the above lists will remain free."**
  - Legacy V3 は 2026-05-15 で廃止。
- → 本アプリが使う `/v2/users/self`, `/v2/users/self/checkins`, `/v2/checkins/{id}` は「無料」区分。**`/v2/users/self/historysearch`(Pro) や `/v2/venues/{id}`(Premium) は呼ばないこと**(詳細画面で venue 詳細を叩くと課金対象)。
- Developer Master Terms §4.2: Free Monthly Credits は月内のみ有効・繰越不可、無くなれば Paid Credits を購入するか翌月まで待つ。402 はこの課金ゲートと関係する可能性(推測)。

### 1.4 新 OAuth 2.1 サーバ(Swarm MCP 用)【確認済:実測】
- `https://api.foursquare.com/.well-known/oauth-authorization-server`(= openid-configuration と同内容):

```json
{
  "issuer": "https://api.foursquare.com",
  "authorization_endpoint": "https://api.foursquare.com/oauth21/authorize",
  "token_endpoint": "https://api.foursquare.com/oauth21/token",
  "jwks_uri": "https://api.foursquare.com/oauth21/jwks",
  "revocation_endpoint": "https://api.foursquare.com/oauth21/revoke",
  "introspection_endpoint": "https://api.foursquare.com/oauth21/introspect",
  "introspection_endpoint_auth_methods_supported": ["none"],
  "revocation_endpoint_auth_methods_supported": ["none"],
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code", "refresh_token"],
  "token_endpoint_auth_methods_supported": ["none"],
  "code_challenge_methods_supported": ["S256"],
  "client_id_metadata_document_supported": true,
  "scopes_supported": ["checkins:read","checkins:write","events:read","events:write","friends:read",
    "lists:read","lists:write","location:read","mcp:connect","offline_access","profile:read",
    "stats:read","tips:read","tips:write","venues:read","venues:write"]
}
```

- `oauth-protected-resource`: `{"resource":"https://api.foursquare.com","authorization_servers":["https://api.foursquare.com"],"bearer_methods_supported":["header"],...}`
- JWKS: RS256 鍵 `kid: oauth21-key-003`(アクセストークンは JWT と推測)。
- `/oauth21/authorize` → 302 で `https://app.foursquare.com/oauth21/authorize?...`(SPA 同意画面。PKCE `code_challenge` 必須、`state` / `resource` / `scope` / `offline_access` を扱う)。
- **サードパーティ利用可否の実測**:
  - `GET /oauth21/appinfo?client_id=FAKECLIENTID...` → 400 `{"error":"invalid_client","error_description":"client_id must be the HTTPS URL of a Client ID Metadata Document"}`
  - `GET /oauth21/appinfo?client_id=https://example.com/client.json...` → 400 `{"error":"invalid_client","error_description":"Client domain 'example.com' is not in the trusted domains list"}`
  - `POST /oauth21/token`, `/oauth21/revoke` (client_id=https://example.com/client.json) → 401 `{"error":"invalid_client","error_description":"Unknown client_id"}`
  - `POST /oauth21/register` → 404(DCR なし)
- 用途: Swarm MCP(Beta)。`https://app.foursquare.com/mcp` の埋め込み JSON: `"connectUrl":"https://api.foursquare.com/v2/streaming/mcp/swarm-beta","toolCount":60`、platforms: Claude(`https://claude.ai/directory/connectors/swarm-by-foursquare`)・ChatGPT。Swarm 公式 X(@SwarmApp)でローンチ告知。
- → **このサーバの revoke/refresh/PKCE は本アプリでは使えない**(Foursquare に trusted domain 追加を依頼できれば将来の移行先)。OAuth モジュールは差し替え可能な抽象にしておくのが無難。

---

## 2. Developer Console(OAuth 用 Client ID / Secret の発行)

### 2.1 手順(公式ドキュメント)
- 登録: Developer Sign Up → メール確認コード → Home。
- "Start a New Project in the Developer Console"(updatedAt 2026-02-12):
  1. Home → **Create New Project**
  2. モーダルで **Project Name**(2つ目以降は Organization も選択) → **Create**
  3. **Project Settings** で Project URL / Privacy Policy URL / Redirect URL を(任意で)入力
  4. **Push API** セクションで通知方式を選択("Disable pushes from this project" 等)
  5. **Save**
- "Using OAuth Authentication": Project Settings の **OAuth Authentication** セクションに **Client ID / Client Secret**。"Reset Client Secret" で再発行可。ユーザー認証(Foursquare/Swarm ユーザーがログインして許可する方式)には **Project URL, Privacy Policy URL, Redirect URL の3つが必須**で、これらはログイン時にエンドユーザーに表示される。

### 2.2 コンソール実装から読み取れた事実【確認済:公開JSバンドル解析】
- ページ: `https://foursquare.com/developers/home`、バンドル `https://ss0.4sqi.net/developers/main.991bed132b6a42d0d1aa.js`(869,909 bytes, 2026-10-16 取得)
- ルート: `/developers/orgs/:orgId/projects/:projectId/settings`(Project Settings)、`/push`、`/places/usage`、`/orgs/:orgId/billing` ほか
- OAuth タイル(コンポーネント名 OAuthTile)抜粋:

```js
r.createElement(Wc,{title:"OAuth Authentication", ...
  tooltip:S?"Used for 3rd Party Application Account Linking":"Legacy Foursquare API uses OAuth to authenticate."},
  r.createElement(gl,null,"Client Id"), ... r.createElement(gl,null,"Client Secret"), ... "Push Secret" ...
  r.createElement(wl,{label:"Project URL",placeholder:"https://www.yourproject.com/", ...}),
  r.createElement(wl,{label:"Privacy Policy URL",placeholder:"https://www.yourproject.com/privacy", ...}),
  r.createElement(Nl,{isCreatable:!0,isMulti:!0,label:"Redirect URL",placeholder:"https://www.yourproject.com/redirect_uri",
     ... isValidNewOption:function(e,t){return e&&t.every((function(t){return t.value!==e}))}, ...}),
  ... "Reset Client Secret"
// 保存: v2/apps/{id}/edit に {applicationUri, privacyPolicyUri, callbackUri: callbackUris[]} を送信。
// サーバ側エラーは response.validationErrors として表示。
```

  - **Redirect URL は複数登録可(multi-select, 配列 `callbackUris`)**。クライアント側の検証は「空でない・重複しない」のみ(スキーム/https/localhost の制限はクライアント側には無い。サーバ側検証は不明)。
  - Project URL / Privacy Policy URL は onBlur でスキームが無ければ `https://` を前置する正規化のみ。
  - プロジェクト設定ページは表示モードに関わらず OAuth タイルを描画(全プロジェクトに Client ID/Secret がある)。
- 新規登録者の審査: `"Thank you for signing up to use Foursquare Developer tools. We are currently processing your application."` / 否認時 `"Looks like you don't have permission to access Foursquare Developer tools."`。状態は `pending / notscreened / screened / failed`(`v2/sanction/self`)。pending 中は Reset Client Secret 等が無効化。
- アカウント種別文字列: `"Enterprise"`, `"Pay As You Go"`, `"AWS Marketplace Pay As You Go"`, `"Sandbox"`。

### 2.3 名称
- コンソール上の名称: セクション "OAuth Authentication"、項目 "Client Id" / "Client Secret"(Personalization API 専用の別名はなし)。ドキュメント上は "Personalization API (deprecated)" / "Legacy (v2) API"。Service API Key(Places/Users API 用)とは別物。

---

## 3. OAuth2 フロー詳細(レガシー)

### 3.1 文書
- 認可: `https://foursquare.com/oauth2/authenticate?client_id=YOUR_CLIENT_ID&response_type=code&redirect_uri=YOUR_REGISTERED_REDIRECT_URI`
- 承諾後: `https://YOUR_REGISTERED_REDIRECT_URI/?code=CODE`
- 交換: `https://foursquare.com/oauth2/access_token?client_id=...&client_secret=...&grant_type=authorization_code&redirect_uri=...&code=CODE` → "response will be JSON" `{ access_token: ACCESS_TOKEN }`
- API 呼び出し: `Authorization: Bearer <ACCESS_TOKEN>`(エンドポイント個別ページでは `oauth_token` クエリ)
- 新 Users API 版の同フロー(app.foursquare.com ホスト)では redirect_uri は "Must exactly match the `redirect_uri` used in Step 1." / "This is a server-to-server request and should not be done client-side."
- 旧ドキュメント(developer.foursquare.com/overview/auth の日本語訳):
  - 「アプリケーションに複数のリダイレクト URI を登録する場合、`redirect_uri` パラメータの値を変更することで使用する URI を指定できます。」
  - 「現時点では OAuth アクセストークンは期限切れではありませんが、期限切れの可能性を考慮してください。」
  - 「また、ユーザは Foursquare の設定画面からいつでも切断することができます。」
  - 「`/authenticate` は…ユーザがすでにアプリケーションを認証していれば自動的にリダイレクトされる」「`/authorize` はつねに認証リクエストを承諾するようユーザに指示します。」
  - `response_type=token`(Web トークンフロー)、`display=touch|webpopup` もあり。
- **state / PKCE / scope / refresh_token / expires_in は現行公式ドキュメントに記載なし。**

### 3.2 実測(2026-10-16, ダミー値のみ)

| リクエスト | 結果 |
|---|---|
| `POST https://foursquare.com/oauth2/access_token` (form: client_id=FAKE..., grant_type=authorization_code, code=FAKE) | 400 `{"error":"invalid_client"}` |
| `GET  https://foursquare.com/oauth2/access_token?...同上...` | 400 `{"error":"invalid_client"}` |
| POST、client 資格情報なし | 400 `{"error":"invalid_client"}` |
| POST、`Authorization: Basic base64(FAKE:FAKE)` のみ | 400 `{"error":"invalid_client"}`(Basic 対応可否は判別不能) |
| POST、grant_type 省略 | 400 `{"error":"unsupported_grant_type"}` |
| POST、`grant_type=refresh_token` | 400 `{"error":"unsupported_grant_type"}` ← **refresh 非対応** |
| POST、`grant_type=client_credentials` | 400 `{"error":"unsupported_grant_type"}` |
| `GET https://foursquare.com/oauth2/authenticate?client_id=FAKE&response_type=code&redirect_uri=http://localhost:3000/cb&state=abc123` | 302 `Location: /login?continue=%2Foauth2%2Fauthenticate%3F...%26state%3Dabc123`(未ログイン時は state を含む全パラメータを保持してログインへ) |
| `GET https://foursquare.com/oauth2/authorize?...` | 302 同様(/authorize も存在) |
| `https://foursquare.com/login` | 308 → `https://app.foursquare.com/login` |
| `https://app.foursquare.com/oauth2/access_token`(POST, FAKE) | 400 `{"error":"invalid_client"}`(app ホストでも同じ) |

- トークンエンドポイントのエラー形式は RFC 6749 風 `{"error": "..."}`(API 本体の `meta` 形式とは別)。
- ヘッダ: `Cache-Control: no-cache, private, no-store`, `X-Frame-Options: SAMEORIGIN`(認可画面は iframe 不可 → トップレベル遷移で行う)。

### 3.3 state がそのまま返るか【間接・未確認】
- 公式文書に記載なし。ただし以下のライブラリはいずれも「state 検証がデフォルト有効」かつ Foursquare 用に state 無効化設定をしていない:
  - next-auth v4: `if (!normalized.checks) normalized.checks = ["state"]`(src/core/lib/providers.ts)。Foursquare プロバイダは provider テスト表(issue #2524, 2021-08)で "Manually tested ✅"。
  - Laravel SocialiteProviders/Foursquare(stateless 指定なし → Socialite 既定で state 検証)。
  - omniauth-foursquare(provider_ignores_state 未設定)。
- さらに未ログイン時の 302 で state が continue パラメータに保持される(実測)。→ 返却される可能性は高いが、**実アカウントで要確認**。
- 参考: Auth.js v5(@auth/core)の既定は `const checks = c.checks ?? ["pkce"]` で state を送らない。Foursquare が PKCE を無視する場合、Auth.js 既定構成では CSRF 防御が効かない(推測)。→ 本アプリは自前実装で state 必須にする。

### 3.4 PKCE / スコープ / 有効期限 / refresh
- レガシー: PKCE・スコープは文書に無し(未確認、未知パラメータとして無視される可能性)。refresh_token グラントは実測で非対応。有効期限は旧文書で「現状なし」。
- OAuth 2.1 サーバ(MCP用)は PKCE 必須・スコープ・refresh あり(ただし本アプリは利用不可、1.4 参照)。

---

## 4. redirect_uri の制約(検証5)
- 複数登録: **可**(コンソールの multi-select 実装 + 旧文書)。
- localhost: **公式記載なし**。第三者の 2025-12〜2026 年の手順で `http://localhost:8765/callback`(His-Story, foursquare-to-dayone の例示)、`http://localhost`(swarm-downloader)を登録して動作している → **http://localhost は登録・利用できる可能性が高い【間接】**。
- 完全一致 / 前方一致: **公式記載なし【未確認】**。トークン交換時の redirect_uri は認可時と完全一致が必要(新 Users API 文書)。
- HTTPS 必須: コンソールのクライアント側検証には無い。サーバ側は未確認。
- 回避策(HTTPS 必須だった場合): `next dev --experimental-https`(Next.js 公式。mkcert で https://localhost:3000 を生成。docs lastUpdated 2026-10-15)が最小コスト。外部到達が必要な場合のみ cloudflared / ngrok。
- 環境分離: L-03/L-04/L-06 に沿い **ローカル用・本番用でプロジェクト(=Client ID/Secret)を分ける**のが推奨(1プロジェクトに複数 Redirect URL も可能だが、秘密情報の分離ができない)。Netlify のデプロイプレビュー等ランダムなホスト名では OAuth が通らない前提で、固定のステージングドメインを用意する。

---

## 5. トークン無効化(検証4)
- レガシー OAuth: **revoke/deauthorize エンドポイントなし【確認済:文書に無し+実測】**

```
revoke GET:  404   https://foursquare.com/oauth2/revoke?token=FAKE
revoke POST: 404   https://foursquare.com/oauth2/revoke
deauthorize POST: 404 https://foursquare.com/oauth2/deauthorize
doesnotexist GET: 404 https://foursquare.com/oauth2/doesnotexist   ← 対照
access_token GET(no params): 400  ← 実在パスは 400
app.foursquare.com/oauth2/revoke POST: 404
```

  - 注: api.foursquare.com/v2 配下は存在しないパスでもトークン検査が先に走り 401 を返すため、v2 配下の存在確認には使えない(`/v2/thisdoesnotexist` も 401)。
- OAuth 2.1 の `revocation_endpoint`(https://api.foursquare.com/oauth21/revoke)は trusted CIMD クライアント専用で、本アプリ(レガシートークン)には適用不可。
- ユーザー側の解除手段: 旧文書「Foursquare の設定画面からいつでも切断可能」。**`https://app.foursquare.com/settings/connections` はログイン要求の 302 を返す実在ルート**(`/settings/apps` や存在しないパスは 404。実測)。画面内容(連携アプリ一覧・解除ボタンの有無)は**未確認**。`https://foursquare.com/settings/*` は 308 で app.foursquare.com へ。
- Swarm MCP については UI 文言 "To change what you shared, or to disconnect Swarm, remove the connector in your assistant's settings and connect again."(= Foursquare 側に解除 UI があるとは書いていない)。
- 設計への影響: F-03 は「自DBのトークンを即時削除(暗号化値ごと)+ disconnected_at 設定 + Foursquare 側での解除方法(上記URL)を案内」。N-09 は「不可(仕様上 revoke API が無い)」として要件を確定させる。

---

## 6. users/self のレスポンス
- 文書(Get User Details, `GET /users/self`, `v` 必須)例の `response.user`:
  - `id`(string, 例 "123456")、`firstName`、`lastName`、`gender`、`handle`、`homeCity`、`birthday`(int)、`createdAt`(int, UNIX秒)
  - `photo`: `{ "prefix": "https://fastly.4sqi.net/img/user/", "suffix": "/blank_boy.png", "default": true }` → URL は `prefix + サイズ + suffix`(例 `prefix + "100x100" + suffix`、`original` も可)
  - `contact`: `email`(例では **空文字 ""**)、`verifiedEmail`、`verifiedPhone`、`facebook`(user スキーマに phone/twitter は無し)
  - `checkins{count, items}`, `friends`, `lists`, `photos`, `tips`, `mayorships`, `requests`, `lenses`, `referralId`, `blockedStatus`, `checkinPings`, `isAnonymous`, `relationship`, `type` 等
- 主要 OSS(Auth.js, social-core, Socialite)は `id`, `firstName + lastName`, `contact.email`, `photo.prefix + "original" + photo.suffix` を使用。
- 推奨: **識別キーは `id`(文字列で保存)**。email は空・未検証の可能性があり Supabase ユーザーの主キー的に使わない。表示名は firstName/lastName 欠落に備える。画像は next/image なら `fastly.4sqi.net` を remotePatterns に追加。

---

## 7. API 共通仕様

### 7.1 v パラメータ
- "The value of the `v` parameter is a date in `YYYYMMDD` format"、意味は「この日付までの API 変更に対応済み」。全リクエストで必須(POST 含む)。URL の `v2` とは無関係。
- 推奨: 全呼び出しで単一の日付を使い、数か月ごとに変更点を確認して上げる。**"Under no circumstances should you always pass in the current date."**
- 非推奨化: レスポンス meta に `errorType: deprecated`(HTTP 200)。移行期間は "at least several months"、開発者メール通知・"API brownouts" 実施。
- 実装: `FSQ_API_VERSION=YYYYMMDD`(実装・検証した日の固定値)を設定で持ち、変更はテスト付きで行う。

### 7.2 m パラメータ
- 現行公式ドキュメントに記載なし。旧文書: `m=swarm|foursquare` でレスポンス形式を選ぶ(例: users 詳細で swarm=チェックイン、foursquare=Tips)。2025〜2026年の利用例(shkspr, spokenlikeageek 等)は `v` のみで動作。→ **省略でよい**(スパイクで m=swarm 有無の差分を一度確認すると安心)。

### 7.3 ロケール
- `Accept-Language` ヘッダ推奨(`locale=` も可)。対応: en(既定), es, fr, de, it, ja, th, tr, ko, ru, pt, id。未指定時は地名等を「その国で最も一般的な言語」で返す。→ カテゴリ名等を検索対象にするなら、同期時の言語を固定する(例 `Accept-Language: ja`)設計判断が必要(検索テーマと調整)。

### 7.4 レート制限(Personalization API Rate Limits, updatedAt 2026-02-12)
- "Foursquare rate limits any application making authenticated requests on a per hour per OAuth token basis."
- "rate limits are, in general, not per endpoint, but per top-level endpoint resource or group."
- Rate Limit (per OAuth Token): Checkins 500 / Lists 1000 / Photos 500 / Search 500 / Tips 500 / Users 500 / Venues 500、例外 Search Autocomplete 2000、POST 500、User Management は Service Key あたり 3600/時。
- 超過時: "our API will return a 403 error, and the response object returned by our API will be empty." `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`(リセット時刻)。
- 試算: `users/self/checkins` は Users グループ扱い(推測)→ 250件×500回/時 = 最大 125,000 件/時/ユーザー。バックフィルは通常 1 時間枠に収まる。`checkins/{id}`(詳細)は Checkins グループ 500/時。

### 7.5 エラー形式
- 文書(Personalization API Errors):
  - 400 Bad Request / 401 Unauthorized / 403 Forbidden / 404 / 405 / 409 / 500
  - errorType: `invalid_auth`(401) / `param_error`(400) / `endpoint_error`(404) / `not_authorized`(403) / `rate_limit_exceeded`(403) / `quota_exceeded`(429) / `deprecated`(200) / `server_error`(varies)
  - `errorDetail`(開発者向け), `errorMessage`(ユーザー向けローカライズ文字列, ある場合)
- 実測:

```
# トークン無し
GET https://api.foursquare.com/v2/users/self?v=20261016
HTTP 400
{"meta":{"code":400,"errorType":"invalid_auth","errorDetail":"Missing access credentials. See https:\/\/developer.foursquare.com\/docs\/api\/configuration\/authentication for details.","requestId":"6ad1916da86da9275f71a6fd"},"response":{}}

# 無効トークン(クエリ oauth_token でも Authorization: Bearer でも同じ)
GET https://api.foursquare.com/v2/users/self/checkins?v=20261016&limit=1  (Authorization: Bearer INVALIDTOKEN123)
HTTP 401
WWW-Authenticate: Bearer realm="https://foursquare.com/login"
Access-Control-Allow-Origin: *
{"meta":{"code":401,"errorType":"invalid_auth","errorDetail":"OAuth token invalid or revoked.","requestId":"6ad1917d5b2e5452fb37d55f"},"response":{}}
```

  - → 「invalid_auth = 401」とは限らない(トークン欠落は 400)。**分岐は `meta.errorType` 優先**。Bearer ヘッダが解釈されること(=URL にトークンを載せずに済む)も確認。
  - 無効トークン応答には X-RateLimit-* ヘッダは付かなかった(有効トークン時は未確認)。
- 追加で考慮: HTTP 402 Payment Required(2025-12 報告。課金/クレジット関連と推測)。

---

## 8. 規約・ブランド

### 8.1 Personalization APIs (Self-Service) EULA(Last Updated: 2024-02-29)
- 定義: End User Data = "personalized data pertaining to your users (e.g., check-ins, lists, photos, ratings, tips, tastes and managed users)"、Personalization Data = End User Data + Personalization API が返す Foursquare Data。
- §3.1: "You must comply with the Personalization API caching and query rate limitations" applicable to your Account-type(具体値は Usage Guidelines に委任)。
- §3.2: **"You must provide Foursquare with branded attribution (i.e., 'Powered by Foursquare')"** on any page or screen where Personalization Data may appear。Visual Crediting Policy を参照。
- §3.3: Personalization Data を表示するページのクロール防止に商業的に合理的な努力。
- §3.4: 第三者への API/データ提供・一括提供・地域全件取得・営業先リスト化の禁止。
- §5: Public beta、"AS IS"、"may be inherently less reliable"。
- §6.2: OAuth 呼び出しは Developer Documentation に従う。得られたデータを広告ネットワーク/アドエクスチェンジ/データブローカー等へ "directly or indirectly transfer" しない(ユーザー同意があっても不可)。

### 8.2 キャッシュ/保存ルール(要注意・不明瞭)
- 現行 Usage Guidelines(fsq-developers-places / -users, updatedAt 2026-02-12)は "retaining data from the Places API" について:
  - fsq_place_id: unlimited caching / Photo IDs: unlimited
  - その他属性: Enterprise は 24時間の端末内キャッシュのみ、**Pay as You Go & Sandbox は "no caching permitted."**
  - "If your application accesses Foursquare user data, you must publish a privacy policy that complies with applicable law."
- 旧 Usage Guidelines(docs.foursquare.com/docs/usage-guidelines。現在は docs トップへ 302 で本文消失。検索エンジンのインデックス上の記述): fsq_id は無期限、その他 Foursquare データは最大30日(リフレッシュ無し)、**"The data of users who haven't authed your app may only be stored for up to three hours."**
- Real Time(Push)API: "not share, retransmit to third parties, retransmit unsecurely, or cache indefinitely any information we transmit to you"。
- Developer Master Terms §14: 契約終了時は Products と Product data を全て破棄。
- 解釈【推測】: 「自アプリを認可したユーザー本人のチェックイン」の永続保存を明示的に許可/禁止する現行条文は見当たらない。チェックインに埋め込まれた venue 属性(店名・住所・カテゴリ)が Places データ扱いになると PAYG では保存不可と読める余地がある。→ **F-13/N-06(raw JSON 永続保存)は Foursquare への書面確認を推奨**。設計上は「ユーザー単位の完全削除」「連携解除時の削除」「必要なら venue 属性の再取得」を可能にしておく。

### 8.3 Visual Crediting Policy / ロゴ
- 基本データ(name, location, category)は venue ページへのリンク(`https://foursquare.com/v/{venue_id}?ref=PROJECT_ID`、`rel="nofollow"` 禁止)。リンクが困難なら視覚的クレジット。Tips/写真は リンク+視覚クレジット。検索結果一覧は視覚クレジットのみで可。
- ロゴ: `https://developer.foursquare.com/assets/PoweredByFSQ21.zip`(HTTP 200, 436,918 bytes, Last-Modified 2021-11-18。中身: PoweredByFSQ_guidelines.pdf と SVG/PNG/JPG の横組/縦組・黒/白/青/ティール。問い合わせ先 Brand@foursquare.com)。自前 CDN でホストするよう指示あり。

### 8.4 Trademark & Brand Feature Guidelines
- 商標: **Foursquare®, Swarm™, 4SQ®, Check-in™**
- ドメイン名・スクリーンネーム・ウェブサイト名・商標に組み込まない/他社の製品・サービス名の一部にしない(書面合意なし)/他語と結合しない/提携・推奨を示唆しない。
- API 機能に紐づき Foursquare のマークを表示するアプリは次の文言を目立つ位置に: "This [application/service] uses the Foursquare® application programming interface but is not endorsed or certified by Foursquare Labs, Inc. All of the Foursquare® logos (including all badges) and trademarks displayed on this [application/service] are the property of Foursquare Labs, Inc."
- API 利用者は "powered by Foursquare®" ロゴをサイト/ストア掲載で表示可。
- → **アプリ名・ドメインに "Swarm" を含めない**(例: 「チェックイン検索」等の一般名+説明文で「Swarm™ のチェックイン履歴を検索」と参照的に記載し、免責文を併記)。"Check-in™" も商標表示されている点に注意(一般語としての説明文使用は通常問題ないと推測、名称化は避ける)。

### 8.5 Platform & Acceptable Use Policy(Last Updated: 2024-03-12)
- 自動取得(スクレイピング)禁止、利用制限の回避禁止、第三者への提供禁止、Foursquare サービスの単体マネタイズ禁止、競合データベース構築禁止、Foursquare のブランド/著作権表示の非表示禁止 等。

### 8.6 Developer Master Terms(Last Updated: 2024-02-29)
- 製品: Places API, Personalization API, SDK。プライバシー法遵守と "posting and complying with a legally sufficient privacy policy"(§7.3)。POI データセット改良目的の利用禁止(§7.5.8)、Foursquare の対ユーザー通知の無効化禁止(§7.5.6)。

---

## 9. Swarm/Foursquare 側ログイン UX(参考)【確認済:公開JSバンドル】
- 認可時に遷移する `https://app.foursquare.com/login` はパスワードレス: "Log in to Foursquare" / "Enter your email or phone to receive a login code" → "Enter your code"(ワンタイムコード)。バンドル内に Apple/Google/Facebook ログインボタンの文言は見当たらない。
- → SNS ログインのみで登録したユーザーがメール/電話を持たない場合に OAuth を完了できない可能性(未確認)。ヘルプ/FAQ に注意書きを用意。
- 余談: Swarm Web には `v2/privateweb/feedskey` を使う RSS/ICS/KML/GeoJSON の個人フィード機能がある(同期テーマ向けの参考情報。仕様未確認)。

---

## 10. Next.js(App Router)での実装提言

### 10.1 フロー設計
1. `POST /auth/foursquare/start`(ボタンは `<form method="post">` か Server Action。`<Link>` プリフェッチ等で誤発火させない)
   - `state` = Web Crypto で 32 バイト乱数 → base64url(43文字)。Node/Workers 両対応のため `crypto.getRandomValues` を使用。
   - 署名付き(HMAC)の一時 Cookie に `{state, intent: "login"|"reconnect", returnTo(相対パスのみ), iat}` を保存。
   - 302 で `https://foursquare.com/oauth2/authenticate?client_id&response_type=code&redirect_uri&state` へ。`/authenticate` を使う(既に認可済みのユーザーは同意画面なしで即リダイレクト=再ログインが速い)。
2. `GET /auth/foursquare/callback`
   - Cookie を読む → 直ちに削除(ワンタイム)。
   - `error` パラメータがあれば(拒否等)キャンセル扱い。`code` / `state` 欠落、Cookie 無し・期限切れ、state 不一致 → 失敗(定数時間比較)。
   - サーバー間で `POST https://foursquare.com/oauth2/access_token`(`application/x-www-form-urlencoded` に client_id / client_secret / grant_type=authorization_code / redirect_uri(認可時と完全一致) / code)。タイムアウト 10s。`access_token` が string でなければ失敗。
   - `GET https://api.foursquare.com/v2/users/self?v=FSQ_API_VERSION`(`Authorization: Bearer`)で `response.user.id` を取得 → fsq_user_id。
   - Supabase 側のユーザー作成/紐付け・セッション発行(別テーマ)。トークンは毎回最新値で上書き保存(再認可で値が変わるか未確認のため)。
   - 303 でコード無しのクリーンな URL へ遷移(`code` を履歴・Referer に残さない)。
3. API 呼び出しラッパ(サーバー専用 `import "server-only"`)
   - `meta.errorType` で分岐: `invalid_auth` → 連携状態を「要再連携」にしてトークン無効フラグ(F-14) / `rate_limit_exceeded`(403) → `X-RateLimit-Reset` まで待機・再開 / `quota_exceeded`(429) → 翌日まで停止 / `not_authorized` / `param_error` → バグとして記録 / HTTP 402 → 運営側課金問題としてアラート(ユーザーには「一時的に利用できません」) / 5xx → 指数バックオフ / 200 で `errorType: deprecated` → 警告ログ。
   - `X-RateLimit-Remaining` を記録し、バックフィルは残量に応じてペース配分。

### 10.2 Cookie 属性
| 属性 | 値 | 理由 |
|---|---|---|
| 名前 | 本番 `__Host-fsq_oauth`、開発 `fsq_oauth` | `__Host-` で Domain なし・Path=/・Secure を強制し、サブドメインからの注入を防ぐ。Safari は http://localhost で Secure Cookie を扱わない場合があるため開発は別名 |
| HttpOnly | true | JS から読ませない |
| Secure | 本番 true / http://localhost 開発時 false | |
| SameSite | **Lax**(Strict 不可) | Foursquare からのトップレベル GET リダイレクトで送信させるため。Strict だとコールバックで Cookie が届かず必ず state 不一致になる |
| Path | / | `__Host-` の要件 |
| Max-Age | 600 秒 | 認可にかかる時間(ログインコード入力含む)を考慮しつつ短く |

- Next.js 15+ では `cookies()` は async。`.set` / `.delete` は Route Handler / Server Function のみで可能(Next.js docs, lastUpdated 2026-06-09)。最新 next は 16.4.2(engines: node >=20.9.0)。

### 10.3 試作コードの要点(未実行のスケッチ)

```ts
// lib/fsq/oauth.ts (server-only)
const AUTHZ = "https://foursquare.com/oauth2/authenticate";
const TOKEN = "https://foursquare.com/oauth2/access_token";
const API = "https://api.foursquare.com/v2";
const V = process.env.FSQ_API_VERSION!;            // 例 "20261016"(固定。毎回の現在日付は禁止)
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-fsq_oauth" : "fsq_oauth";

const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function newState() { return b64url(crypto.getRandomValues(new Uint8Array(32))); }

export function authorizeUrl(state: string) {
  const u = new URL(AUTHZ);
  u.searchParams.set("client_id", process.env.FSQ_CLIENT_ID!);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", process.env.FSQ_REDIRECT_URI!); // 登録値と完全一致させる
  u.searchParams.set("state", state);
  return u;
}

export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: process.env.FSQ_CLIENT_ID!, client_secret: process.env.FSQ_CLIENT_SECRET!,
      grant_type: "authorization_code", redirect_uri: process.env.FSQ_REDIRECT_URI!, code,
    }),
    cache: "no-store", signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || typeof json.access_token !== "string") throw new FsqOAuthError(json.error ?? `http_${res.status}`);
  return json.access_token;                         // token_type / expires_in は来ない前提(文書)
}

export async function fsqGet(path: string, token: string, params: Record<string, string> = {}) {
  const u = new URL(API + path);
  u.searchParams.set("v", V);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const res = await fetch(u, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, cache: "no-store" });
  const body = await res.json().catch(() => null);
  const type = body?.meta?.errorType as string | undefined;
  if (res.ok && body?.meta?.code === 200) { if (type === "deprecated") console.warn("fsq deprecated", body.meta); return body; }
  if (type === "invalid_auth") throw new FsqAuthError();                  // 400(欠落) or 401(無効/取消)
  if (type === "rate_limit_exceeded") throw new FsqRateLimitError(res.headers.get("X-RateLimit-Reset"));
  if (type === "quota_exceeded" || res.status === 429) throw new FsqQuotaError();
  if (res.status === 402) throw new FsqBillingError();
  if (res.status >= 500) throw new FsqRetryableError(res.status);
  throw new FsqApiError(res.status, type, body?.meta?.errorDetail);
}

// app/auth/foursquare/callback/route.ts(要点)
// const jar = await cookies(); const saved = verifyHmac(jar.get(COOKIE)?.value); jar.delete(COOKIE);
// if (url.searchParams.get("error")) -> /login?e=cancelled
// if (!code || !state || !saved || !timingSafeEqualStr(state, saved.state) || expired(saved.iat)) -> /login?e=state
// const token = await exchangeCode(code); const me = await fsqGet("/users/self", token);
// const fsqUserId = String(me.response.user.id);  -> Supabase 側処理(別テーマ) -> 303 redirect(saved.returnTo)
```

### 10.4 その他の注意
- ログ: `code`、`access_token`、コールバック URL 全体、トークン交換の body を記録しない。
- コールバックは `Cache-Control: no-store`、`Referrer-Policy: no-referrer`(または strict-origin)。
- 既にログイン中のユーザーが別の Foursquare アカウントで認可して戻ってきた場合の扱い(切替 or 拒否)を明確化。fsq_user_id は一意制約。
- 検索結果・詳細画面に "Powered by Foursquare" ロゴ、venue へのリンク(`?ref=PROJECT_ID`)、免責文。認証必須ページは `X-Robots-Tag: noindex` / robots.txt で Disallow(EULA §3.3)。
- 広告・トラッキングタグ(広告ネットワーク)をチェックイン表示ページに入れない(EULA §6.2)。
- プライバシーポリシーページを用意し Console の Privacy Policy URL に登録(ユーザー認証の必須項目)。

---

## 11. 要件への影響まとめ
| 要件 | 影響 |
|---|---|
| F-01 | Foursquare は OIDC ではない(id_token/標準 userinfo なし)。access_token → `users/self` の `id` を外部IDとしてサーバー側でセッション発行する方式が必須(Supabase 側方式は別テーマ)。 |
| F-02 / N-02 | トークンは無期限想定の長寿命秘密。暗号化保存・クライアント非送出・ログ非出力。refresh_token は無い。 |
| F-03 | revoke API なし → 自DBから即削除+Foursquare 設定(app.foursquare.com/settings/connections 想定)への案内。 |
| F-04 | 表示項目: 表示名/アイコン(users/self)、connected_at、last_synced_at、最終API結果(invalid_auth なら「要再連携」)。 |
| F-05 | 「Foursquare OAuth の再実行不要」は字義通りには不可(ログアウト後に本人確認する手段が Foursquare OAuth しかない)。`/oauth2/authenticate` なら認可済みユーザーは同意画面なしで即戻るため、「再同意不要・ワンクリック再ログイン」と読み替えるのが現実的。トークンは削除せず保持し、新トークン取得時は上書き。 |
| F-14 | `invalid_auth`(400/401) → 再連携誘導。`rate_limit_exceeded`(403)/`quota_exceeded`(429) → 時間をおいて自動再開。402 → 運営側障害扱い。 |
| N-04 | API 本体は `Access-Control-Allow-Origin: *` を返すがクライアントからは呼ばない(トークン秘匿)。 |
| N-08 | state(HttpOnly + SameSite=Lax の一時 Cookie と照合)を実装。state 返却は実地確認必須。PKCE はレガシーでは効果不明(送っても害はない想定だが、防御として数えない)。 |
| N-09 | 不可(レガシーに revoke なし。OAuth 2.1 の revoke は trusted クライアント限定)。要件を「Foursquare 側での解除方法を案内」に変更推奨。 |

---

## 12. 未確定事項と実地検証手順(実アカウント必須)
1. **新規アカウントでの v2 利用可否**: 新規 Developer 登録 → 審査状態確認 → プロジェクト作成 → Redirect URL に `http://localhost:3000/auth/foursquare/callback` 登録 → 実 Swarm アカウントで OAuth → `users/self`, `users/self/checkins?limit=250`, `checkins/{id}` を呼び、402/403 が出ないこと、レスポンスヘッダ(X-RateLimit-*)を記録。Billing ページの残高/カード要否も記録。
2. **redirect_uri 規則**: 登録値と (a) 完全一致 (b) 末尾スラッシュ違い (c) 追加クエリ付き (d) 下位パス (e) ポート違い (f) http/https 違い で認可を試し、エラー画面/挙動を記録。localhost(http)が拒否されたら `next dev --experimental-https` で https://localhost:3000 を試す。
3. **state / error 返却**: state にランダム値を付けて認可→コールバック URL の state を確認。同意画面で拒否した時のクエリ(`error=access_denied` 等)を記録。`/authenticate` の自動リダイレクト(2回目以降同意画面なし)を確認。
4. **トークン応答と寿命**: トークンエンドポイントの生 JSON(token_type, expires_in 等の有無)を記録。同一ユーザーで再認可した際に同じトークンが返るか/旧トークンが無効化されるか。
5. **PKCE**: `code_challenge`(S256)を付けて認可し、交換時に誤った `code_verifier` を送ってもトークンが出るか(出れば PKCE 非対応)。
6. **ユーザー側解除**: app.foursquare.com/settings/connections に本アプリが表示されるか、解除後に保存トークンで `users/self` が 401 `invalid_auth`("OAuth token invalid or revoked.")になるか。パスワード変更・アカウント削除時の挙動も可能なら確認。
7. **users/self 実データ**: email の有無・photo・lastName 欠落など。`m=swarm` 有無で checkins レスポンス差分があるか。
8. **規約確認(書面)**: 自ユーザーのチェックイン(venue 属性含む)を raw JSON で無期限保存し検索することの可否、連携解除後2週間保持の可否、"Powered by Foursquare" 表示位置、アプリ名。Foursquare Developer Support(コンソール内問い合わせ)/ Brand@foursquare.com に照会。
9. **ログイン手段**: SNS のみで登録した Swarm アカウントが Web のメール/電話コードログインで OAuth を完了できるか。
10. **将来**: OAuth 2.1(PKCE/refresh/revoke)の trusted domains に一般アプリを追加できるか Foursquare に照会。

---

## 13. 参考 URL
- https://docs.foursquare.com/ (製品一覧: Personalization API - Deprecated / Users API New!)
- https://docs.foursquare.com/developer/reference/get-user-checkins
- https://docs.foursquare.com/developer/reference/get-user-details
- https://docs.foursquare.com/developer/reference/v2-authentication
- https://docs.foursquare.com/developer/reference/personalization-apis-authentication
- https://docs.foursquare.com/developer/docs/using-oauth-authentication
- https://docs.foursquare.com/developer/docs/create-a-new-project
- https://docs.foursquare.com/developer/reference/versioning
- https://docs.foursquare.com/developer/reference/personalization-apis-rate-limits
- https://docs.foursquare.com/developer/reference/personalization-apis-errors
- https://docs.foursquare.com/developer/reference/personalization-apis-localization
- https://docs.foursquare.com/developer/reference/real-time-view
- https://docs.foursquare.com/developer/reference/upcoming-changes
- https://docs.foursquare.com/developer/reference/personalization-api-release-notes
- https://docs.foursquare.com/fsq-developers-users/reference/authentication.md
- https://docs.foursquare.com/fsq-developers-users/reference/usage-guidelines.md
- https://docs.foursquare.com/fsq-developers-places/reference/usage-guidelines.md
- https://docs.foursquare.com/fsq-developers-users/reference/visual-crediting-policy.md
- https://foursquare.com/legal/terms/personalization-apis-self-service-eula/
- https://foursquare.com/legal/terms/enterprise-developermasterterms/
- https://foursquare.com/legal/terms/aup/
- https://foursquare.com/legal/terms/trademark-and-brand-feature-guidelines/ , https://app.foursquare.com/legal/trademark
- https://foursquare.com/pricing/
- https://developer.foursquare.com/assets/PoweredByFSQ21.zip
- https://api.foursquare.com/.well-known/oauth-authorization-server , https://api.foursquare.com/.well-known/oauth-protected-resource
- https://app.foursquare.com/mcp , https://swarmapp.com/mcp/
- https://foursquare.com/developers/home(バンドル https://ss0.4sqi.net/developers/main.991bed132b6a42d0d1aa.js)
- https://app.foursquare.com/login(バンドル https://ss1.4sqi.net/swarm/main.9ca5bc43b468cd94fdbd.js)
- https://docs-foursquare-api-ja.readthedocs.io/ja/latest/overview/auth.html , .../versioning.html(旧 v2 ドキュメント和訳)
- https://www.spokenlikeageek.com/2025/12/01/exporting-foursquare-check-ins-to-day-one/
- https://shkspr.mobi/blog/2026/06/using-foursquares-api-to-post-location-checkins-to-social-media/
- https://github.com/ericblue/swarm-downloader , https://github.com/mjanssen19/His-Story , https://github.com/williamsdb/foursquare-to-dayone
- https://github.com/tsu-nera/dailybuild/issues/92
- https://github.com/nextauthjs/next-auth/issues/2524 , next-auth v4 `src/core/lib/providers.ts` , @auth/core `src/lib/utils/providers.ts` , `src/providers/foursquare.ts`
- https://github.com/python-social-auth/social-core/blob/master/social_core/backends/foursquare.py
- https://github.com/SocialiteProviders/Providers/blob/master/src/Foursquare/Provider.php
- https://github.com/arunagw/omniauth-foursquare
- https://nextjs.org/docs/app/api-reference/functions/cookies , https://nextjs.org/docs/app/api-reference/cli/next

---

## 付録A: 実測ログ(抜粋)

```
PS> probe.ps1 -Url "https://api.foursquare.com/v2/users/self?v=20261016"
STATUS: 400 Bad Request
  Access-Control-Allow-Origin: *
  Content-Type: application/json; charset=utf-8
  Via: 1.1 varnish
BODY: {"meta":{"code":400,"errorType":"invalid_auth","errorDetail":"Missing access credentials. See https:\/\/developer.foursquare.com\/docs\/api\/configuration\/authentication for details.","requestId":"6ad1916da86da9275f71a6fd"},"response":{}}

PS> probe.ps1 -Url "https://api.foursquare.com/v2/users/self/checkins?v=20261016&limit=1&oauth_token=INVALIDTOKEN123"
STATUS: 401 Unauthorized
  WWW-Authenticate: Bearer realm="https://foursquare.com/login"
BODY: {"meta":{"code":401,"errorType":"invalid_auth","errorDetail":"OAuth token invalid or revoked.","requestId":"6ad1917091036f3b324f46b1"},"response":{}}

PS> probe.ps1 -Url "https://foursquare.com/oauth2/access_token" -Method POST -Body "client_id=FAKECLIENTID&client_secret=FAKESECRET&grant_type=authorization_code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fauth%2Fcallback&code=FAKECODE"
STATUS: 400 Bad Request
  Cache-Control: no-cache, private, no-store
  X-Frame-Options: SAMEORIGIN
BODY: {"error":"invalid_client"}

t_nocreds: {"error":"invalid_client"}
t_basic: {"error":"invalid_client"}
t_nogrant: {"error":"unsupported_grant_type"}
t_refresh: {"error":"unsupported_grant_type"}
t_clientcreds: {"error":"unsupported_grant_type"}

PS> probe.ps1 -NoRedirect -Url "https://foursquare.com/oauth2/authenticate?client_id=FAKECLIENTID&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcb&state=abc123"
STATUS: 302 Found
  Location: /login?continue=%2Foauth2%2Fauthenticate%3Fclient_id%3DFAKECLIENTID%26response_type%3Dcode%26redirect_uri%3Dhttp%253A%252F%252Flocalhost%253A3000%252Fcb%26state%3Dabc123

settings (foursquare.com)        308 -> https://app.foursquare.com/settings
app.foursquare.com/settings              302 -> /login?continue=%2Fsettings
app.foursquare.com/settings/connections  302 -> /login?continue=%2Fsettings%2Fconnections
app.foursquare.com/settings/apps         404
app.foursquare.com/settings/privacy      302 -> /login?continue=%2Fsettings%2Fprivacy
app.foursquare.com/settings/doesnotexist123 404

--- OAuth 2.1 ---
appinfo (example.com CIMD): {"error":"invalid_client","error_description":"Client domain 'example.com' is not in the trusted domains list"} HTTP 400
appinfo (non-URL client id): {"error":"invalid_client","error_description":"client_id must be the HTTPS URL of a Client ID Metadata Document"} HTTP 400
token (fake code):   {"error":"invalid_client","error_description":"Unknown client_id"} HTTP 401
revoke (fake token): {"error":"invalid_client","error_description":"Unknown client_id"} HTTP 401
introspect:          {"error":"invalid_client","error_description":"Missing client_id"} HTTP 401
register (DCR?):     HTTP 404
/oauth21/authorize (api host) -> 302 https://app.foursquare.com/oauth21/authorize?...(state 等そのまま)
```

## 付録B: Swarm Web(app.foursquare.com)OAuth 2.1 同意画面のスコープ説明文(バンドル抜粋)
- profile:read "Read profiles, mayorships, achievements, and scoreboards"
- checkins:read "Read checkin history and activity feeds — yours and your friends'"
- checkins:write "Add, edit, and delete checkins"
- offline_access(refresh 用)、mcp:connect(常に付与扱い)ほか
- 必須パラメータ検証: "Missing required parameter: client_id" / "redirect_uri" / "code_challenge"
