import { ExternalLink } from 'lucide-react';

/** Foursquare のプライバシー設定のページ(データのダウンロードを申請する場所) */
export const FSQ_PRIVACY_SETTINGS_URL = 'https://foursquare.com/settings/privacy';

/** エクスポートの申請手順の案内(IMPT-01、F-16) */
export function ImportGuide() {
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <div className="space-y-2">
        <h3 className="font-semibold">パソコンから申し込む(おすすめ)</h3>
        <ol className="list-decimal space-y-1 pl-5 text-stone-700 dark:text-stone-300">
          <li>
            <a href={FSQ_PRIVACY_SETTINGS_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1">
              Foursquare のプライバシー設定のページ
              <ExternalLink className="size-3.5" aria-hidden />
              <span className="sr-only">(新しいタブで開きます)</span>
            </a>{' '}
            を開きます。ログインを求められたら、Swarm と同じアカウントでログインします。
          </li>
          <li>
            ページの下のほうにある <strong>「Initiate Data Download Request」</strong>(日本語表示では「自分のデータをエクスポート」など)を押します。
          </li>
          <li>確認のメールが届きます。メールの案内に従って、申し込みを確定します。</li>
        </ol>
        <p className="text-stone-600 dark:text-stone-400">
          ページが開けない場合は、foursquare.com にログインして、右上の名前 → Settings → Privacy Settings と進んでください。
        </p>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">Swarm アプリから申し込む</h3>
        <ol className="list-decimal space-y-1 pl-5 text-stone-700 dark:text-stone-300">
          <li>Swarm アプリを開き、左上のプロフィール(自分のアイコン)を押します。</li>
          <li>右上の歯車(設定)を押し、「プライバシー設定(Privacy Settings)」を開きます。</li>
          <li>下へスクロールして、「Initiate Data Download Request」を押します。</li>
        </ol>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold">届いたあと</h3>
        <ol className="list-decimal space-y-1 pl-5 text-stone-700 dark:text-stone-300">
          <li>通常 2〜3 日(最大 7 日)で、Foursquare から、ダウンロード用のリンクが書かれたメールが届きます。届かないときは、迷惑メールのフォルダも確認してください。</li>
          <li>メールのリンクを開き、ZIP ファイルをダウンロードします。リンクには有効期限があることがあるので、早めにダウンロードしてください。</li>
          <li>ZIP は<strong>展開せず、そのまま</strong>下の手順 2 で選びます(自動で展開されたときは、「展開済みのフォルダを選択」を使います)。</li>
        </ol>
      </div>

      <p className="text-stone-700 dark:text-stone-300">
        新しいチェックインを反映したいときは、もう一度申し込んで、届いた ZIP を読み込み直してください(差分だけが反映されます)。
      </p>
      <p className="text-xs text-stone-500 dark:text-stone-400">
        画面の名前は、Foursquare や Swarm の更新で変わることがあります。見つからないときは、「Privacy」「Data」「Download」などの言葉を探してください。このリンクを押すと、Foursquare のサイトに移動します(このアプリとは別のサイトです)。
      </p>
    </div>
  );
}
