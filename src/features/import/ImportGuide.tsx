/** エクスポートの申請手順の案内(IMPT-01、F-16) */
export function ImportGuide() {
  return (
    <div className="space-y-3 text-sm leading-relaxed">
      <dl className="space-y-3">
        <div>
          <dt className="font-semibold">Swarm アプリから</dt>
          <dd className="text-stone-700 dark:text-stone-300">
            プロフィール → 設定(歯車)→ プライバシー設定 →「Initiate Data Download Request」
          </dd>
        </div>
        <div>
          <dt className="font-semibold">Web から</dt>
          <dd className="text-stone-700 dark:text-stone-300">foursquare.com にログイン → Settings → Privacy Settings → 同上</dd>
        </div>
      </dl>
      <p className="text-stone-700 dark:text-stone-300">
        通常 2〜3 日(最大 7 日)で、ダウンロード用のリンクがメールで届きます。リンクには有効期限があることがあるので、届いたら早めにダウンロードしてください。
      </p>
      <p className="text-stone-700 dark:text-stone-300">新しいチェックインを反映したいときは、もう一度申請して、届いた ZIP を読み込み直してください(差分だけが反映されます)。</p>
    </div>
  );
}
