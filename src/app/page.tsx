import Link from 'next/link';
import { Check, ShieldCheck, X } from 'lucide-react';
import { PageContainer } from '@/components/ui/misc';
import { HomeActions } from '@/features/app/HomeActions';
import { IosNotice } from '@/features/app/IosNotice';

export default function HomePage() {
  return (
    <PageContainer className="space-y-10">
      <section className="space-y-6 pt-4">
        <h1 className="text-3xl leading-tight font-bold tracking-tight sm:text-4xl">
          Swarm のチェックイン履歴を、
          <br />
          店名やコメントで検索できます。
        </h1>
        <p className="leading-relaxed text-stone-700 dark:text-stone-300">
          Foursquare 公式の「データのダウンロード」で届くファイルを、このブラウザに読み込んで検索します。
          <br className="hidden sm:inline" />
          ログインは不要で、データはこの端末の外に出ません。
        </p>
        <HomeActions />
        <IosNotice always />
      </section>

      <section aria-labelledby="howto" className="space-y-3">
        <h2 id="howto" className="text-lg font-bold">
          使い方
        </h2>
        <ol className="list-decimal space-y-2 pl-6 leading-relaxed">
          <li>Swarm の設定から、データのダウンロードを申請します(数日でメールが届きます)。</li>
          <li>届いた ZIP ファイルを、このアプリで読み込みます。</li>
          <li>店名・コメントで検索できます。「一蘭 OR (ラーメン 渋谷)」のような AND / OR の組み合わせも使えます。</li>
        </ol>
      </section>

      <section aria-labelledby="features" className="grid gap-4 sm:grid-cols-2">
        <h2 id="features" className="sr-only">
          できること・できないこと
        </h2>
        <div className="rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
          <h3 className="mb-3 font-bold">できること</h3>
          <ul className="space-y-2 text-sm leading-relaxed">
            {['店名(英語表記・現地語)・コメント・イベント名での検索', 'AND / OR と括弧を使った検索', '日時の新しい順のタイムライン表示', '写真の表示、Foursquare の店ページへのリンク'].map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-stone-200 bg-white p-5 dark:border-stone-800 dark:bg-stone-900">
          <h3 className="mb-3 font-bold">できないこと</h3>
          <ul className="space-y-2 text-sm leading-relaxed">
            {['住所・カテゴリでの検索(エクスポートに含まれないため)', '自動での更新(新しいチェックインはエクスポートを読み込み直して反映)', '別の端末とのデータの共有'].map((t) => (
              <li key={t} className="flex gap-2">
                <X className="mt-0.5 size-4 shrink-0 text-stone-500" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section aria-labelledby="privacy" className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-900 dark:bg-emerald-950/30">
        <h2 id="privacy" className="mb-2 flex items-center gap-2 font-bold">
          <ShieldCheck className="size-5 text-emerald-700 dark:text-emerald-400" aria-hidden />
          データはこの端末の中だけ
        </h2>
        <ul className="list-disc space-y-1 pl-6 text-sm leading-relaxed">
          <li>読み込んだデータはこのブラウザの中だけに保存します。サーバーには送りません。</li>
          <li>ログインは不要です。解析ツール・広告・Cookie は使いません。</li>
          <li>同じブラウザを使う人はデータを見られます。共有のパソコンでは使わないでください。</li>
        </ul>
        <p className="mt-3 text-sm">
          詳しくは <Link href="/privacy">プライバシーポリシー</Link> と <Link href="/about">このアプリについて</Link> をご覧ください。
        </p>
      </section>
    </PageContainer>
  );
}
