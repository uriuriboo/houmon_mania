# 12_result.json (agent a120cf608ca9445e0)

## TOPIC: sb-auth: 外部OAuth(Foursquare)ログイン後に Supabase のユーザー作成・セッション発行をサーバー側で行う方式(F-01 / F-05 / N-02 / 検証1)

### summary
推奨は方式(a)です。Foursquare OAuth は Next.js の Route Handler で自前実装します(state Cookie で CSRF 対策)。サーバーで users/self を呼んで fsq_user_id を確定し、初回だけ secret key のクライアントで auth.admin.createUser を呼びます(合成メール、email_confirm:true)。その後 generateLink({type:'magiclink'}) で得た hashed_token を verifyOtp({token_hash, type:'email'}) に渡してセッションを作り、@supabase/ssr の Cookie(httpOnly 可)に保存します。

この流れではメールは送信されません。合成メールも形式チェックだけで受理されます。MX/DNS チェックや .invalid のブロックは、メールを送る時にしか動きません。また DisableSignup や Email プロバイダ無効の設定は admin 経路と /verify では参照されません。ここまでは supabase/auth のソースで確認した内容です。ホスト環境での実機確認はまだです。

Foursquare は Supabase の標準プロバイダにありません。2026年に追加された Custom OAuth プロバイダ(oauth2 型)で登録自体はできます。ただし userinfo のトップレベルに sub が必須で、attribute_mapping もネストしたフィールドを参照できません。Foursquare の users/self はネスト構造なので、そのままでは "missing provider id" で失敗します。さらに PKCE 交換で返る provider_token が SSR の Cookie にそのまま保存されます(オフライン実験で確認)。これは N-02 と衝突するので、MVP の主方式には向きません。

一番大きな運用リスクはレート制限です。/verify は IP 単位で30回/5分、/token は150回/5分で、サーバーから呼ぶとサーバーの IP に集中します。対策は二つあり、Sb-Forwarded-For ヘッダ(secret key で呼ぶ場合のみ有効、新規プロジェクトでは明示的な有効化が必要)と、制限値の引き上げです。

最新版は @supabase/ssr 0.12.7、supabase-js 2.118.0、Next.js 16.4.2、Supabase CLI 2.121.0(ローカルの GoTrue は v2.197.0)です。supabase-js は 2.110.0 から Node 22 以上が必須になりました。開発機の Node 20.11.1 では、createServerClient を呼んだ時点で WebSocket 不在の例外が出ます(実験で再現)。

Next.js 16 では middleware.ts が proxy.ts に変わり、Node ランタイム固定になりました。Cloudflare(OpenNext)での proxy 対応は実験扱いです。secret key のクライアントは、セッションが無いと黙って service_role に昇格します(実験で確認)。そのため Cookie と連携しない別インスタンスにする必要があります。

F-05 は、端末記憶トークン(httpOnly / __Host- Cookie、DB にはハッシュのみ、ローテーションと再利用検知、再開時に Foursquare のトークン有効性を確認)で実現できます。ただし共有端末のリスクを受け入れる設計判断になります。

### findings

- **[F1] CRITICAL (high)** Foursquare は Supabase Auth の標準プロバイダに無い。Custom OAuth/OIDC Providers(oauth2 型)で登録はできるが、userinfo のトップレベルに文字列の sub が必須で、attribute_mapping はトップレベルの既知クレーム間の付け替えとリテラル値しかできない。そのため Foursquare の users/self(response.user.id のネスト構造)はアダプタ無しでは使えない。
  - detail: supabase/auth の provider ディレクトリに foursquare は無い。CLI の config.toml のプロバイダ一覧にも無い。Custom provider は 2026-05 の Developer Update(v1.26.05)で告知され、self-hosted は Auth v2.196.0 以上が必要。Free プランは3個まで。pkce_enabled は既定 true、email_optional は既定 false。

ソースで確認した内容: custom_oauth.go の applyAttributeMapping は Claims 構造体を map にして claimsMap[v] を参照するだけで、ネストしたパスには対応していない。identity.go の NewIdentity は identityData["sub"] が無いと "error missing provider id" を返す。userinfo は golang oauth2 クライアントの GET に Authorization: Bearer を付けて取得している。

同じエラーは issue supabase/auth#2519(2026-05起票、Open)でも報告されている。自前の userinfo アダプタ(Route Handler で sub/name/picture に変換)を挟めば理論上は動くが、Foursquare 側の互換性は未検証(Bearer の受理、トークン応答が access_token のみであること、PKCE パラメータの扱い)。
  - sources: https://supabase.com/docs/guides/auth/custom-oauth-providers , https://supabase.com/docs/guides/self-hosting/self-hosted-custom-oauth-providers , https://github.com/supabase/auth/blob/master/internal/api/provider/custom_oauth.go , https://github.com/supabase/auth/blob/master/internal/models/identity.go , https://github.com/supabase/auth/issues/2519 , https://github.com/supabase/supabase/releases/tag/v1.26.05 , https://github.com/supabase/auth/tree/master/internal/api/provider

- **[F2] CRITICAL (high)** Custom provider 方式(PKCE)では、exchangeCodeForSession が返す session に provider_token(=Foursquare access_token)が含まれる。@supabase/ssr はそれを含む session 全体を Cookie に保存するので、トークンがブラウザへ送られる。さらに provider token は交換が終わるまで auth.flow_state に平文で保存される。
  - detail: external.go は flowState.ProviderAccessToken に保存し、token.go の PKCE グラントで token.ProviderAccessToken として返してから flow_state を削除する。auth-js の _sessionResponse は応答フィールドをすべて session にコピーし、_saveSession が session 全体をストレージ(=Cookie)に書く。

オフライン実験(モック fetch)の Test1 では、応答に provider_token を含めると Cookie JSON のキーに provider_token が入ることを確認した。Test4 では experimental の cookies.encode:'tokens-only' でも provider_token が残った。Test7 では、setSession で張り直した Cookie には provider_token が入らなかった。

このため custom provider 方式を採るなら Cookie を上書きするハックが必要で、N-02(クライアントに一切送出しない)と衝突する。
  - sources: https://github.com/supabase/auth/blob/master/internal/api/external.go , https://github.com/supabase/auth/blob/master/internal/api/token.go , https://github.com/supabase/supabase-js/tree/master/packages/core/auth-js , C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\exp-scripts\ssr-cookie-experiment.out.txt

- **[F3] CRITICAL (high)** 方式(a)(admin.createUser + admin.generateLink(magiclink) + verifyOtp(token_hash, type:'email'))ではメールが一切送信されない。合成メールも形式チェック(badoux/checkmail)だけで受理され、MX/DNS チェックや .invalid / example.com のブロックはメール送信時のラッパーでしか動かない。
  - detail: mail.go の adminGenerateLink は validateEmail(checkmail.ValidateFormat)を通した後、ユーザーが未登録なら magiclink を signup に変換し、64文字のランダムパスワードでユーザーを作る。その後 one-time token を作り、action_link / email_otp / hashed_token / verification_type を JSON で返すだけで、mailer は呼ばない。公式 JSDoc にも 'generateLink() handles the creation of the user for signup, invite and magiclink' とある。

validateclient.go の拡張検証(予約 TLD のブロックと MX/A ルックアップ)は emailValidatorMailClient.Mail() の中でのみ実行される。

auth-js の verifyOtp の JSDoc では email の場合 signup/magiclink type は deprecated なので type:'email' を使う。verify.go は type:'email' のとき confirmation/recovery の両方の token を探す。

補足: 内蔵 SMTP はチームメンバー以外には送らない(Email address not authorized)。正規表現の JS 近似テストでは fsq_12345@example.invalid が FORMAT_OK だった。ホスト環境での実機確認は未実施。
  - sources: https://github.com/supabase/auth/blob/master/internal/api/mail.go , https://github.com/supabase/auth/blob/master/internal/mailer/validateclient/validateclient.go , https://github.com/supabase/auth/blob/master/internal/api/verify.go , https://github.com/supabase/auth/blob/master/internal/api/admin.go , https://supabase.com/docs/reference/javascript/auth-admin-generatelink , https://supabase.com/docs/guides/auth/auth-smtp , https://github.com/orgs/supabase/discussions/19320

- **[F4] CRITICAL (high)** IP 単位のレート制限は /verify が30回/5分(バースト30)、/token(refresh/password/pkce/id_token 共通)が150回/5分(バースト30)。admin エンドポイントと GET /user には IP 制限が無い。サーバー経由の呼び出しはサーバーの IP に集中するため、Sb-Forwarded-For(secret key 必須、新規プロジェクトでは明示的な有効化が必要)を使うか、制限値を変更する。
  - detail: 既定値は docs 表と packages/shared-data/config.ts の値。変更はダッシュボード(Authentication > Rate Limits)か、Management API の PATCH /v1/projects/{ref}/config/auth で rate_limit_verify / rate_limit_token_refresh などを指定する。ローカルは config.toml の [auth.rate_limit](token_verifications=30, token_refresh=150)。

IP 転送は公式に「set the Sb-Forwarded-For header … make a request with a secret API key. Publishable API keys and legacy anon/service_role API keys are not supported」「must be explicitly enabled for new projects」とあり、設定項目は security_sb_forwarded_for_enabled。

ソース(sbff.go / middleware.go)では、ヘッダ左端の値を IP として解釈できればそれを制限キーにする。Auth 自体は鍵の種別を判定していないので、secret key 限定はゲートウェイ側で担保していると推測。api.go では /admin/* に limitHandler が無く、/user は PUT にだけ付いている。

実験 Test6/Test7 で、global.headers に入れた sb-forwarded-for が secret key 付きで /auth/v1/verify に送られることを確認した。x-forwarded-for の左端は偽装できる場合があるので、Netlify なら x-nf-client-connection-ip、Cloudflare なら cf-connecting-ip を使うべき(推測、Netlify はフォーラム回答が根拠)。
  - sources: https://supabase.com/docs/guides/auth/rate-limits , https://github.com/supabase/supabase/blob/master/packages/shared-data/config.ts , https://github.com/supabase/auth/blob/master/internal/sbff/sbff.go , https://github.com/supabase/auth/blob/master/internal/api/middleware.go , https://github.com/supabase/auth/blob/master/internal/api/api.go , https://github.com/supabase/cli/blob/develop/apps/cli-go/pkg/config/templates/config.toml , https://answers.netlify.com/t/is-the-client-ip-header-going-to-be-supported-long-term/11203

- **[F5] CRITICAL (high)** @supabase/supabase-js は 2.110.0(2026-06-30)から engines.node >=22 になった。最新の 2.118.0 を Node v20.11.1 で使うと、createServerClient を呼んだ時点で 'Node.js detected but native WebSocket not found' 例外になる。
  - detail: npm view の結果では engines.node が 2.79.0〜2.109.0 は >=20.0.0、2.110.0 以降は >=22.0.0。@supabase/ssr 0.12.7 の peerDependencies は supabase-js ^2.114.0、next@16.4.2 の engines は >=20.9.0。

実験では npm install 時に EBADENGINE 警告が出た。実行時には RealtimeClient の初期化で例外になり、realtime.transport にダミーを渡すと回避できた。discussion #45715 によると Node 20 は 2026-04-30 に EOL、supabase-js での Node 20 サポートは 2026-06-30 に終了。開発機・CI・ホスティング(Netlify Functions 等)をすべて Node 22 以上にする必要がある。
  - sources: https://www.npmjs.com/package/@supabase/supabase-js , https://www.npmjs.com/package/@supabase/ssr , https://github.com/orgs/supabase/discussions/45715 , C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\research\sb-auth.md

- **[F6] CRITICAL (high)** secret key のクライアントは、ユーザーセッションがあれば Authorization: Bearer <ユーザーJWT> を送って RLS が適用され、セッションが無ければ Authorization: Bearer sb_secret_… を送って service_role(RLS バイパス)になる。Cookie と連携した SSR クライアントに secret key を渡すと、Cookie が欠けたときに黙って権限が昇格する。
  - detail: 公式 RLS ドキュメントの原文: 'A secret key bypasses RLS only when the request carries no user access token. If the request carries one, it runs under the RLS policies of that signed-in user'。公式トラブルシュートの原文: 'If you are using SSR, always create a separate server client using supabase-js directly for service role.'。Admin API リファレンスでは secret key 必須で、auth は autoRefreshToken:false / persistSession:false を指定している。

実験 Test3 で REST リクエストのヘッダを観測した。admin(セッション無し)と secret+Cookie(セッション無し)は Bearer sb_secret、secret+Cookie(セッション有り)は Bearer ユーザーJWT、publishable(セッション無し)は Bearer sb_publishable だった。

このため、ユーザー権限クライアント(publishable)と admin クライアント(secret、Cookie 非連携、server-only)を分ける。secret key で signIn 系や verifyOtp を呼んだクライアントはデータ取得に流用しない。
  - sources: https://supabase.com/docs/guides/database/postgres/row-level-security , https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z , https://supabase.com/docs/reference/javascript/admin-api , https://supabase.com/docs/guides/getting-started/api-keys

- **[F7] (high)** httpOnly Cookie を使い、ブラウザ用 Supabase クライアントを一切使わない構成について、公式は「サーバー側だけでロジックを実装する従来型 Web アプリなら可能(ライブラリのサポートは限定的)」としている。@supabase/ssr の cookieOptions.httpOnly は実際に反映される(maxAge は400日固定)。
  - detail: sessions.mdx の原文: 'This is possible, but only for apps that use the traditional server-only web app approach … the Supabase JavaScript libraries provide only limited support.'。一方 advanced-guide の FAQ は「HttpOnly は不要」という立場。

@supabase/ssr の DEFAULT_COOKIE_OPTIONS は { path:'/', sameSite:'lax', httpOnly:false, maxAge:400日 } で、cookieOptions がこれを上書きする(ただし maxAge は常に既定値で上書きされる)。setAll の第2引数で Cache-Control/Expires/Pragma の no-store 系ヘッダが渡される(v0.10.0〜)。

実験 Test1 では { httpOnly:true, secure:true, sameSite:'lax' } が Set-Cookie オプションに反映された。Test5 では signOut({scope:'local'}) が POST /logout?scope=local を送り、maxAge:0 で Cookie を削除した。
  - sources: https://supabase.com/docs/guides/auth/sessions , https://supabase.com/docs/guides/auth/server-side/advanced-guide , https://github.com/supabase/ssr , C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\exp-scripts\ssr-cookie-experiment.out.txt

- **[F8] (high)** セッション発行は分離構成にできる。secret key クライアント(Cookie 非連携、sb-forwarded-for 付き)で verifyOtp を呼び、返ったトークンを publishable key のサーバークライアントで setSession する。こうすると secret key を Cookie に一切関与させずに httpOnly のセッション Cookie を発行でき、追加の通信は GET /user の1回だけ。
  - detail: auth-js の _setSession は、期限内なら _getUser で GET /user を呼んでから _saveSession し、SIGNED_IN を通知する。これを受けて @supabase/ssr が Cookie を書く。GET /user には IP レート制限が無い(api.go)。

実験 Test7 の HTTP の流れは、POST /auth/v1/verify(apikey sb_secret、sb-forwarded-for 198.51.100.23)→ GET /auth/v1/user(apikey sb_publishable、Bearer ユーザーJWT)。Cookie は httpOnly/secure で、キーに provider_token は含まれなかった。代わりに公式サンプルのように secret key の createServerClient で直接 verifyOtp してもよいが、そのクライアントは使い捨てにすること。
  - sources: https://github.com/supabase/supabase-js/tree/master/packages/core/auth-js , https://github.com/supabase/auth/blob/master/internal/api/api.go , https://supabase.com/docs/guides/auth/rate-limits , C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\exp-scripts\ssr-cookie-experiment.cjs

- **[F9] CRITICAL (high)** Next.js 16 では middleware.ts が非推奨になり proxy.ts に改名された。proxy は Node.js ランタイム固定で、runtime 設定はエラーになる。Supabase 公式の SSR 構成は proxy で getClaims() を呼んでトークンを更新する前提だが、Cloudflare(OpenNext)の proxy.ts 対応は実験扱いで、メンテナがサポートしないと明言している。
  - detail: Next.js docs の proxy ページには「v16.0.0 Middleware is deprecated and renamed to Proxy. Proxy defaults to the Node.js runtime」とある。Server Functions は proxy のチェーンとは別のルートなので、各 Server Function の中で認証/認可を再確認するよう書かれている。cookies().set/delete は Server Function と Route Handler だけで使え、Server Component では使えない。

Supabase の creating-a-client には「Next.js 15 以前は middleware.ts」「refresh を2か所でやるとランダムにサインアウトされる」との注記がある。

opennextjs-cloudflare の PR #1309(Node.js middleware/proxy.ts 対応)は 2026-08-25 にマージされた。nodejs_compat が必須で警告ログが出る実験機能であり、メンテナは「サポートするつもりはない」と発言している。関連のビルド不具合 issue #1400 も Open。Netlify での proxy.ts 対応状況は今回の調査では公式情報を確認できなかった。
  - sources: https://nextjs.org/docs/app/api-reference/file-conventions/proxy , https://nextjs.org/docs/app/api-reference/functions/cookies , https://nextjs.org/docs/app/guides/data-security , https://supabase.com/docs/guides/auth/server-side/creating-a-client , https://github.com/opennextjs/opennextjs-cloudflare/pull/1309 , https://github.com/opennextjs/opennextjs-cloudflare/issues/1400

- **[F10] (high)** getClaims() は非対称鍵(新規プロジェクトの既定)ならローカルの JWKS で署名を検証し、期限が90秒以内なら先に refresh する。ただし失効済みのセッションは検出できない。getUser() は Auth サーバーに問い合わせ、signOut 後なら session_not_found(403)になる。
  - detail: 公式 auth_methods には「Use getClaims to protect pages … locally via WebCrypto and a cached JWKS … or by calling getUser solely to validate when symmetric keys are in use」とある。advanced-guide には「getClaims() verifies the token's signature and expiry … an unexpired token stays valid even when the session behind it was revoked. Call getUser() where that gap matters.」とある。

auth-js 実装では JWKS はモジュールグローバルに10分(JWKS_TTL)キャッシュされ、EXPIRY_MARGIN は90秒。auth.go の maybeLoadUserOrSession は 'Session from session_id claim in JWT does not exist' を返す。実験 Test2 では、getClaims が発生させた通信は JWKS 取得の1回だけだった。

ローカル CLI は signing_keys_path を設定しないと HS256(既定の jwt_secret)になり、getClaims は毎回 getUser にフォールバックする(CLI ソースからの推定)。
  - sources: https://supabase.com/docs/guides/auth/server-side/creating-a-client , https://supabase.com/docs/guides/auth/server-side/advanced-guide , https://github.com/supabase/auth/blob/master/internal/api/auth.go , https://supabase.com/docs/guides/auth/signing-keys , https://github.com/supabase/cli/blob/develop/apps/cli-go/pkg/config/apikeys.go

- **[F11] (high)** 新キー体系(publishable: sb_publishable_…、secret: sb_secret_…)はどちらも JWT ではない。legacy の anon/service_role は2026年末までに廃止予定で、2025年11月以降の新規プロジェクトにはそもそも存在しない。ローカル CLI の status も Publishable/Secret を表示する。
  - detail: api-keys.mdx の要点:
- publishable は ログイン無しで anon、ログイン済みで authenticated になる。secret は service_role(BYPASSRLS)。
- 'A secret key doesn't work in a browser. Supabase matches on the User-Agent header and returns HTTP 401'。
- キーは apikey ヘッダで送る。
- 推奨の環境変数は NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / SUPABASE_URL / SUPABASE_SECRET_KEY(secret には接頭辞を付けない)。

廃止予定については、partial が 'deprecating the anon and service_role keys by the end of 2026' と書き、discussion #29260 は「2025-11 以降の新規プロジェクトにはレガシーキーが無い」「Late 2026 (TBC) 削除」としている。

CLI の status.go によると、supabase status -o env は PUBLISHABLE_KEY / SECRET_KEY / API_URL に加えて、非推奨扱いの ANON_KEY / SERVICE_ROLE_KEY / JWT_SECRET も出力する。ローカル既定キーは固定値(apikeys.go)。要件 L-03 の文言(anon/service role)は更新が必要。
  - sources: https://supabase.com/docs/guides/getting-started/api-keys , https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys , https://github.com/orgs/supabase/discussions/29260 , https://github.com/supabase/cli/blob/develop/apps/cli-go/internal/status/status.go , https://github.com/supabase/cli/blob/develop/apps/cli-go/pkg/config/apikeys.go , https://supabase.com/docs/guides/local-development/cli/getting-started

- **[F12] (high)** signOut の scope は global(JS の既定、そのユーザーの全セッション削除)、local(現在のセッションだけ)、others(現在以外)。どれでも削除されるのはセッション行と refresh token で、発行済みのアクセストークンは exp まで有効なまま。
  - detail: signout.mdx の原文: 'With the global scope, calling signOut() on one device revokes the refresh tokens for every session that user has' / 'Access Tokens of revoked sessions remain valid until their expiry time'。

ソース(logout.go / sessions.go)では global は DELETE FROM auth.sessions WHERE user_id=?、local は WHERE id=session_id、others は id != かつ user_id=。auth-js の _signOut は 401/403/404 を無視してローカルのセッションを消す(others のときはローカルを消さない)。advanced-guide は SSR では scope:'local' を明示するよう推奨している。

即時に失効させたい操作では、JWT の session_id が auth.sessions に存在するかを確認する(sessions.mdx)。サーバー側から切る場合は auth.admin.signOut(jwt, scope) を使う。
  - sources: https://supabase.com/docs/guides/auth/signout , https://supabase.com/docs/guides/auth/sessions , https://github.com/supabase/auth/blob/master/internal/api/logout.go , https://github.com/supabase/auth/blob/master/internal/models/sessions.go , https://supabase.com/docs/guides/auth/server-side/advanced-guide

- **[F13] (medium)** ユーザー削除では、自前テーブルを auth.users に on delete cascade で参照させるのが公式推奨。ただし auth.users へのトリガーや満たせない FK は 'Database error deleting user' の原因になる。Vault の secret はユーザーと FK で結ばれないので残る。
  - detail: managing-user-data.mdx に該当する記述:
- references auth.users on delete cascade を推奨。
- deleteUser(既定 shouldSoftDelete:false)は auth.users 行を消し、auth.sessions へ cascade して refresh token を無効化する。
- 発行済みアクセストークンは exp まで有効。
- Storage の所有者は削除できない。

トラブルシュート文書によると、auth.users のトリガーは supabase_auth_admin の最小権限で動くため、auth スキーマ外を触ると権限エラーになる。FK が原因なら CASCADE か SET NULL にする。

以下は推測: 数万行の checkins を持つユーザーを deleteUser すると、GoTrue の削除トランザクション内で大量の cascade が走り遅延やタイムアウトの恐れがある。F-42 のバッチで先にチャンク削除する方が安全。vault.secrets は削除フローの中で明示的に消す必要がある。shouldSoftDelete:true では行が残るので cascade は発火しない(ソース上 Logout と identities のソフト削除のみ)。
  - sources: https://supabase.com/docs/guides/auth/managing-user-data , https://supabase.com/docs/guides/troubleshooting/dashboard-errors-when-managing-users-N1ls4A , https://github.com/supabase/auth/blob/master/internal/api/admin.go

- **[F14] (high)** user_metadata はユーザー自身が PUT /user で検証なしに書き換えられるため、認可(RLS 含む)に使ってはいけない。raw_app_meta_data はユーザーが更新できず認可データ向き。ただしどちらも JWT に載るので秘密ではなく、Cookie サイズにも影響する。
  - detail: users.mdx に 'Do not use it in security sensitive context (such as in RLS policies or authorization logic), as this value is editable by the user without any checks.'、RLS ドキュメントに 'raw_app_meta_data - cannot be updated by the user, so it's a good place to store authorization data' とある。JWT は更新されるまで古い値のままで、Cookie は 4096 バイト制限に注意が必要。

admin createUser は app_metadata に {provider:'email', providers:['email']} を入れ、そこに指定値をマージする。id(UUID)も指定できる。

設計上の推奨: fsq_user_id の正は foursquare_accounts(unique)に置き、ログイン時の照合は secret key でこのテーブルを引く。app_metadata は JWT で参照したい場合の補助にとどめる。表示名やアイコンは自前テーブルに置く。
  - sources: https://supabase.com/docs/guides/auth/users , https://supabase.com/docs/guides/database/postgres/row-level-security , https://github.com/supabase/auth/blob/master/internal/api/admin.go

- **[F15] (medium)** (b) 派生パスワード + signInWithPassword と (c) 自前 JWT 署名は、どちらも2026年時点で非推奨とするのが妥当。(b) は Email プロバイダの有効化が必須で、ユーザーが自分でパスワードを変えるとサーバーからのログインが壊れる。(c) は refresh token と auth.sessions が無く、getClaims の対象外。
  - detail: (b): token.go の password グラントは External.Email.Enabled でなければ 'Email logins are disabled' になる。そのため /otp や /recover などの公開経路も開いてしまう。CLI 既定の secure_password_change=false では PUT /user でパスワードを変更できる(推測: ユーザー操作でサーバー側のログインが壊れる)。秘密鍵 K が漏れれば全アカウントが乗っ取られ、/token の制限枠を refresh と共有する。

(c): signing-keys.mdx によると、非対称鍵への移行後は秘密鍵を抽出できない。発行するには自前の鍵を import(supabase gen signing-key --algorithm ES256)して rotate する必要がある。jwts.mdx は 'getClaims() is meant to be used only with JWTs issued by Supabase Auth' と明記している。

(d) Third-party Auth(Custom OIDC)は HTTPS の issuer、非対称鍵 + kid、role クレームが必須で、'not available in the Supabase CLI'。auth.uid() は sub が UUID の場合しか使えない。匿名サインイン + linkIdentity は結局 custom provider が必要で、匿名サインインは 30回/時/IP に制限される。
  - sources: https://github.com/supabase/auth/blob/master/internal/api/token.go , https://supabase.com/docs/guides/auth/signing-keys , https://supabase.com/docs/guides/auth/jwts , https://supabase.com/docs/guides/auth/third-party/custom-oidc , https://supabase.com/docs/guides/auth/third-party/overview , https://supabase.com/docs/guides/auth/auth-anonymous

- **[F16] (medium)** DisableSignup(サインアップ無効)は公開 /signup、匿名サインイン、外部 OAuth でのアカウント作成でしか参照されない。admin createUser / generate_link と /verify は、DisableSignup も Email プロバイダ無効も見ていない。このため方式(a)は公開のメール系エンドポイントを閉じたまま運用できる見込み。
  - detail: ソースを grep した結果、DisableSignup を参照しているのは signup.go、anonymous.go、external.go の CreateAccount のみ。External.Email.Enabled を参照しているのは requireEmailProvider(/recover)と token.go の password 経路で、/verify と /admin には無い。

CLI の [auth.email] enable_signup は、実際には ExternalEmailEnabled(Email プロバイダの有効/無効)に対応する(apps/cli-go/pkg/config/auth.go)。名前と意味がずれていて紛らわしい。

推測: ホスト環境では、ゲートウェイや別レイヤーで追加の制約がある可能性がある。実機確認が必要。
  - sources: https://github.com/supabase/auth/blob/master/internal/api/signup.go , https://github.com/supabase/auth/blob/master/internal/api/middleware.go , https://github.com/supabase/auth/blob/master/internal/api/api.go , https://github.com/supabase/cli/blob/develop/apps/cli-go/pkg/config/auth.go

- **[F17] (medium)** 同じユーザーで generateLink が並行して走ると、先に発行した hashed_token の verify が 'Email link is invalid or has expired' で失敗する。CreateOneTimeToken が同種のトークンを消してから作るため。
  - detail: one_time_token.go の CreateOneTimeToken は、最初に ClearOneTimeTokenForUser(tx, userID, tokenType) を呼ぶ。mail.go の magiclink 経路は recovery_token と recovery_sent_at も上書きする。

2タブで同時にログインするなどの稀なケースで起きるので、1回リトライすれば吸収できる。古い issue #1357(同じ OTP が返る)は not planned でクローズ済みで、現行ソースは毎回 crypto.GenerateOtp で生成している。
  - sources: https://github.com/supabase/auth/blob/master/internal/models/one_time_token.go , https://github.com/supabase/auth/blob/master/internal/api/mail.go , https://github.com/supabase/auth/issues/1357

- **[F18] CRITICAL (medium)** F-05(ログアウト後も OAuth を再実行せずに即座に再開)を満たすには、ログアウト後もブラウザに残る端末固有の長期資格情報(remember-device トークン)が必要になる。これは『その端末を持つ人は Foursquare 認証なしで再ログインできる』という設計判断を受け入れることを意味する。
  - detail: 設計案(推測を含む提案):
- 初回ログイン時に、32バイト乱数を __Host- 接頭辞の httpOnly / Secure / SameSite=Lax Cookie に入れ、DB(device_logins)には sha256 だけを保存する。
- ログアウトは signOut({scope:'local'}) だけ行い、端末トークンと Foursquare トークンは残す。
- 再開は Server Action(Origin/Host 照合あり)で行う。手順は次の通り。
  - レート制限
  - ハッシュ照合
  - Foursquare の users/self で有効性と fsq_user_id の一致を確認
  - 方式(a)でセッション発行
  - 端末トークンをローテーション(直前値の再利用を検知したら全失効)
- 連携解除や「全端末ログアウト」では、端末トークンをすべて失効させる。

主なリスクと緩和策:
- 共有端末: 自動再開しない、記憶の消去を選べるようにする、期限を短くする、ログイン画面に個人情報を出さない。
- トークン窃取: ローテーションと再利用検知、端末一覧からの失効。
- DB 漏洩: ハッシュのみ保存。
- 再開エンドポイントの濫用: レート制限と Sb-Forwarded-For。

Next.js の Server Actions は POST 限定で、Origin と Host を照合して CSRF を防ぐ(公式)。
  - sources: https://nextjs.org/docs/app/guides/data-security , https://supabase.com/docs/guides/auth/sessions , https://supabase.com/docs/guides/auth/signout , https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Set-Cookie

- **[F19] (medium)** Foursquare v2 の公式ドキュメントは、アクセストークンを 'Authorization: Bearer <ACCESS_TOKEN>' で送るよう案内している。一方、2017年の golang/oauth2 issue では Bearer だと invalid_auth、oauth_token クエリだと成功したという報告がある。トークン応答の例は {"access_token": …} だけで、token_type・期限・PKCE への言及は無い。
  - detail: custom provider 方式(Supabase が Bearer で userinfo を呼ぶ)の成否に関わる。方式(a)では自前実装なので、oauth_token クエリでも Bearer でも選べる。現行の挙動は実機で確認する必要がある。
  - sources: https://docs.foursquare.com/developer/reference/v2-authentication , https://github.com/golang/oauth2/issues/252

### recommendations
- 基本設計では F-01 の実装方式を方式(a)で確定する。流れは、自前の Foursquare OAuth(state Cookie)→ users/self → admin.createUser(初回のみ)→ admin.generateLink(magiclink)→ verifyOtp(token_hash, type:'email')→ httpOnly Cookie にセッション保存。Custom OAuth プロバイダ(custom:foursquare)は、userinfo アダプタが必要なことと provider_token が Cookie に漏れる問題があるため、将来検討扱いにする。
- 開発機・CI・ホスティングのランタイムを Node 22 LTS 以上に更新する(supabase-js 2.110.0 以降の必須条件。Node 20 では生成時に例外になる)。Next.js 16.4.x、@supabase/ssr 0.12.7、@supabase/supabase-js 2.118.0 を基準にする。
- Supabase クライアントは用途別に分けて実装する。(1) ユーザー権限: publishable key + Cookie(httpOnly / secure / sameSite=lax)+ setAll でキャッシュ無効化ヘッダを付与。(2) admin: secret key、persistSession / autoRefreshToken / detectSessionInUrl を false、Cookie と連携しない、import 'server-only'。(3) セッション発行専用: secret key + sb-forwarded-for で verifyOtp を呼び、結果を (1) の setSession で Cookie にする。secret key のクライアントはデータ取得に絶対に流用しない。
- Supabase 側の設定方針(ローカルで動作確認したうえで本番に適用): 『Allow new users to sign up』をオフ、Email プロバイダをオフ、Email OTP の有効期限を短縮(例300秒)、IP Address Forwarding を有効化(security_sb_forwarded_for_enabled)、必要に応じて rate_limit_verify / rate_limit_token_refresh を引き上げ。新規プロジェクトが非対称 JWT 署名鍵(ES256)であることも確認する。ローカルは config.toml で同じ値にし、signing_keys_path で ES256 にそろえる。
- Sb-Forwarded-For に入れる利用者 IP は、プラットフォームが保証するヘッダから取る(Netlify は x-nf-client-connection-ip、Cloudflare は cf-connecting-ip)。x-forwarded-for の左端をそのまま使わない。
- 合成メールは、自前ドメインのサブドメイン(Null MX)にランダムなローカル部を付けた形にする(例: u_<uuid>@users.<自ドメイン>)。fsq_user_id を推測可能な形でメールに入れない。fsq_user_id の正は foursquare_accounts(unique)に置く。user_metadata は認可にも表示データにも使わない。
- セッション更新は proxy.ts(Next 16)の getClaims() に一本化する。Server Action と Route Handler では毎回 getClaims で認証し直す。連携解除・アカウント削除・端末失効などの重要操作では getUser()(session_not_found を検出できる)を使う。Server Component で getSession を信頼しない。
- ログアウトは signOut({scope:'local'}) にする。『全端末からログアウト』は scope:'global' + 端末トークンの全失効。連携解除(F-03)は、全セッション削除 + 端末トークン全失効 + Foursquare トークン削除を1つの処理で行う。
- F-05 は remember-device トークン方式(§9 の設計)で詳細設計する。そのうえで『ログアウト後も同じ端末からワンクリックで再ログインできる(共有端末リスクを受け入れる)』ことを要件オーナーに明示的に確認する。Foursquare の authenticate が既承認ユーザーに同意画面を出さないなら、OAuth を再実行する方式(よりシンプル)も比較する。
- 削除系: 自前テーブルは auth.users に on delete cascade(または foursquare_accounts 経由)で参照させる。ただし大量の checkins は F-42 のバッチで先にチャンク削除してから deleteUser する。Vault の secret は削除フローの中で明示的に消す。auth.users にトリガーを付けない(付けるなら SECURITY DEFINER にして search_path を固定)。
- 要件 L-03 の『anon key・service role key』を『publishable key・secret key』に改め、.env.local の変数名を決める。サーバー専用構成なので publishable key も NEXT_PUBLIC_ を付けないサーバー変数でよい。
- ホスティング選定では、Next 16 の proxy.ts(Node ランタイム)が実運用で動くかを優先して確認する。Cloudflare(OpenNext)は実験扱いなので、採用するなら非推奨の middleware.ts(Edge)へのフォールバックも検討する。

### open_questions
- ホスト環境で『Allow new users to sign up=オフ』と『Email プロバイダ=オフ』にしたまま、admin.createUser / admin.generateLink / verifyOtp(token_hash, type:'email')でセッションが発行できるか。手順: 本番相当の検証プロジェクトで2設定をオフにし、Node 22 のスクリプト(secret key)で、合成メールでの createUser → generateLink(magiclink)→ 別クライアントで verifyOtp を実行する。成功すること、Auth ログにメール送信が出ないこと、公開の /otp・/recover が 'Email logins are disabled' 等で拒否されることを確認する。ローカルでも config.toml の [auth] enable_signup=false、[auth.email] enable_signup=false で同じ手順を実行し、Mailpit(54324)に何も届かないことを確認する。
- 合成メールのドメイン(.invalid と自前ドメインの両方)がホスト環境の createUser / generateLink で受理されるか。手順: 両方の形式でユーザーを作成し、エラーコード(email_address_invalid 等)の有無を確認する。
- IP Address Forwarding の実際の挙動。手順: (1) 有効化前に同じ IP から /verify を31回以上呼んで 429 になることを確認。(2) security_sb_forwarded_for_enabled=true にして、secret key + sb-forwarded-for を毎回変えて呼び、制限が IP ごとに分かれることを確認。(3) publishable key ではヘッダが無視されることを確認。(4) Free プランで設定できるか、rate_limit_verify / rate_limit_token_refresh をどこまで引き上げられるかをダッシュボードと Management API で確認する。
- デプロイ先(Netlify または Cloudflare+OpenNext)で、Next.js 16.4 の proxy.ts から @supabase/ssr の getClaims による refresh と Cookie の書き戻しが安定して動くか。手順: 最小アプリをデプロイし、JWT の有効期限を短く(例300秒)して、期限を越えてページ遷移したとき Cookie が更新されランダムなサインアウトが起きないことを確認する。Netlify では standalone ビルドで proxy.js の ENOENT が起きないかも確認する。
- Foursquare の OAuth/API の挙動。(1) /v2/users/self が Authorization: Bearer で通るか、oauth_token クエリが必要か。(2) oauth2/authenticate が既承認ユーザーに同意画面を出さず即リダイレクトするか(F-05 の代替案の判断材料)。(3) access_token エンドポイントが POST(form)と Basic 認証を受け付けるか、PKCE パラメータを無視するか(custom provider を将来検討するとき用)。手順: 実アカウントと開発用アプリで curl と ブラウザを使って確認する。
- 数万件の checkins を持つユーザーで auth.admin.deleteUser を実行したときの cascade の所要時間とタイムアウトの有無。手順: ローカルに fixture を投入して計測し、先行してバッチ削除すべきかを判断する。
- F-05 の要件解釈: ログアウト後に同じ端末から Foursquare 認証なしで再開できることを、共有端末リスクとして受け入れるか。端末記憶の有効期限(例30日スライディング、上限180日)と『この端末の記憶を消す』UI の要否。プロダクトオーナーの判断が必要。
- ローカル CLI(GoTrue v2.197.0)で auth.admin.customProviders.createProvider が使えるか、userinfo アダプタ(host.docker.internal 経由)へ到達できるか。custom provider 方式を将来評価する場合のみ確認する。

### artifacts
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\research\sb-auth.md
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\exp-scripts\ssr-cookie-experiment.cjs
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\exp-scripts\ssr-cookie-experiment.out.txt
- C:\Users\Yamaoka\AppData\Local\Temp\claude\c--Users-Yamaoka-Code-web-swarm-search\2476ae5c-dc8e-44ea-b566-5413e0032909\scratchpad\exp-scripts\checkmail-test.cjs
