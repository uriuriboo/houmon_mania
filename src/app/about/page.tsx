import type { Metadata } from 'next';
import Link from 'next/link';
import { PageContainer, PageTitle } from '@/components/ui/misc';
import { GoogleAnalytics } from '@/components/google-analytics';
import { WebAnalytics } from '@/components/web-analytics';
import { FSQ_PRIVACY_SETTINGS_URL } from '@/features/import/ImportGuide';
import { SearchHelpContent } from '@/features/search/SearchHelp';
import { APP_NAME, APP_NAME_JA } from '@/lib/constants';
import { BLOG_URL, ISSUES_URL, REPO_URL, TRADEMARK_NOTICE, UNOFFICIAL_NOTICE } from '@/lib/legal';

export const metadata: Metadata = {
  description:
    'Swarm のチェックイン履歴を検索する非公式ツールの使い方、できること・できないこと、検索の書き方、Foursquare の規約との関係、よくある質問。',
  title: 'このアプリについて',
};

export default function AboutPage() {
  return (
    <PageContainer>
      <GoogleAnalytics />
      <WebAnalytics />
      <PageTitle>このアプリについて</PageTitle>
      <div className="prose-ja">
        <p>
          {APP_NAME}({APP_NAME_JA})は、Swarm のチェックイン履歴を、店名やコメントで検索するためのツールです。Foursquare
          公式の「データのダウンロード」で届くファイルを、お使いのブラウザに読み込んで検索します。
        </p>

        <h2>非公式のツールです</h2>
        <p>
          {UNOFFICIAL_NOTICE}
          {TRADEMARK_NOTICE}
        </p>

        <h2>Foursquare の規約との関係</h2>
        <ul>
          <li>
            本アプリは <strong>Foursquare の API を使いません</strong>。利用者ご本人が Foursquare 公式の機能で受け取ったデータ(データポータビリティ)を、ご本人の端末で読み込みます。
          </li>
          <li>
            読み込んだデータは<strong>ブラウザの中だけ</strong>に保存し、運営者のサーバーには送りません。運営者はデータを預からず、見ることもできません。
          </li>
          <li>
            店名などの情報は、Foursquare の利用規約上、<strong>個人的・非商用の利用</strong>が許諾されているものです。本アプリは非商用で、ご本人のデータをご本人が検索する用途に限って提供しています。読み込んだデータを他の人に配ったり、商用目的で使ったりしないでください。
          </li>
          <li>友人の一覧・他の人のコメント・支払いや端末の情報など、ご本人のチェックイン以外のデータは読み込みません。</li>
          <li>Foursquare・Swarm のロゴやブランドの色は使っていません。アプリ名にも Foursquare・Swarm の名前を含めていません。</li>
          <li>
            広告は使っていません。トップ・このアプリについて・プライバシーポリシーの 3 ページだけ、アクセス解析(Vercel Web Analytics と Google アナリティクス)で訪問者数を数えています。Cookie は保存しない設定で、個人は特定しません。検索・取り込み・データ管理のページでは、何も数えず、何も送りません。
          </li>
        </ul>

        <h2>使い方</h2>
        <ol>
          <li>
            Swarm アプリの「プロフィール → 設定(歯車)→ プライバシー設定 → Initiate Data Download Request」、または{' '}
            <a href={FSQ_PRIVACY_SETTINGS_URL} target="_blank" rel="noopener noreferrer">
              Foursquare のプライバシー設定のページ
            </a>{' '}
            から、データのダウンロードを申請します。詳しい手順は <Link href="/import">データの取り込み</Link> にあります。
          </li>
          <li>数日で届くメールのリンクから ZIP ファイルをダウンロードし、<Link href="/import">データの取り込み</Link> で読み込みます。</li>
          <li><Link href="/search">検索</Link> で店名・コメントを入力します。</li>
        </ol>

        <h2>できること・できないこと</h2>
        <table>
          <tbody>
            <tr>
              <th>検索できる項目</th>
              <td>店名(英語表記・現地語)・コメント・場所名・イベント名</td>
            </tr>
            <tr>
              <th>検索できない項目</th>
              <td>住所・市区町村・カテゴリ(エクスポートに含まれないため)。店ページのリンクから Foursquare で確認できます</td>
            </tr>
            <tr>
              <th>データの更新</th>
              <td>自動では更新しません。エクスポートを申請し直して読み込むと、差分だけが反映されます</td>
            </tr>
            <tr>
              <th>端末</th>
              <td>データはブラウザごとに別です。パソコンとスマホの両方で使う場合は、それぞれで読み込んでください</td>
            </tr>
          </tbody>
        </table>

        <h2>検索の書き方</h2>
      </div>
      <SearchHelpContent />
      <div className="prose-ja">
        <h2>よくある質問</h2>
        <h3>データはどこに保存されますか?</h3>
        <p>お使いのブラウザの保存領域(IndexedDB)です。運営者のサーバーには送りません。同じ端末でも、ブラウザが違えば別のデータになります。</p>
        <h3>データが消えてしまいました</h3>
        <p>
          ブラウザがデータを消すことがあります(Safari は 7 日間サイトを開かないと消すことがあります。端末の空き容量が少ないときも消されることがあります)。エクスポートの ZIP
          を読み込み直せば元に戻ります。iPhone・iPad では、ホーム画面に追加して、そこから使うと消えにくくなります。
        </p>
        <h3>Swarm で削除したチェックインが残っています</h3>
        <p>
          新しいエクスポートを ZIP のまま(または展開したフォルダごと)読み込むと、「今回のエクスポートに含まれていないもの」として表示され、削除を選べます。誤って大量に消さないよう、件数などの条件を満たす場合だけ選べます。
        </p>
        <h3>写真が表示されません</h3>
        <p>写真は Foursquare の画像サーバーから表示します。オフラインのときや、非公開の写真は表示できないことがあります。</p>
        <h3>「カフェ」で検索しても、カフェが見つかりません</h3>
        <p>エクスポートにカテゴリが含まれないため、店名に「カフェ」が入っている店だけが見つかります。店名やコメントの言葉で検索してください。</p>

        <h2>ツールについて</h2>
        <p>
          このツールの作り方や技術的な解説は、作者の{' '}
          <a href={BLOG_URL} target="_blank" rel="noopener noreferrer">
            技術ブログ
          </a>{' '}
          で公開する予定です。リンク先は別のサイトで、広告が含まれる場合があります。
        </p>

        <h2>ソースコード・ライセンス</h2>
        <p>
          MIT License で公開しています。ソフトウェアは現状のまま提供し、使用によって生じたいかなる損害についても、作者は責任を負いません。
        </p>
        <p>
          ソースコードは{' '}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
            GitHub
          </a>{' '}
          で読めます。「データを外に送らない」ことは、コードで確かめられます。不具合・要望は{' '}
          <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
            Issues
          </a>{' '}
          へ(チェックインの内容は書かないでください)。
        </p>
      </div>
    </PageContainer>
  );
}
