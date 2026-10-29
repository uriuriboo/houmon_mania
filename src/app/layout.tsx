import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { GaBoundary } from '@/components/ga-boundary';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { ToastProvider } from '@/components/ui/toast';
import { AppStateProvider } from '@/features/app/AppStateProvider';
import { StatusBanner } from '@/features/app/StatusBanner';
import { APP_NAME, APP_NAME_JA, SITE_URL } from '@/lib/constants';
import './globals.css';

const SITE_TITLE = `${APP_NAME}(${APP_NAME_JA})`;
const SITE_DESCRIPTION =
  'Swarm のチェックイン履歴を、公式のデータエクスポートから読み込み、店名やコメントで検索できる非公式ツール。データはブラウザの中だけに保存し、送信しません。';
/** SNS 共有用の画像(1200×630)。scripts/generate-og.mjs で作る静的な PNG */
const OG_IMAGE = { alt: `${SITE_TITLE}のロゴと説明`, height: 630, url: '/og.png', width: 1200 };

export const metadata: Metadata = {
  // 相対パスの画像 URL を、公開 URL に直す。ドメインを変えるときは constants.ts の SITE_URL を書き換える
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s | ${APP_NAME}` },
  description: SITE_DESCRIPTION,
  openGraph: { description: SITE_DESCRIPTION, images: [OG_IMAGE], locale: 'ja_JP', siteName: APP_NAME, title: SITE_TITLE, type: 'website' },
  twitter: { card: 'summary_large_image', description: SITE_DESCRIPTION, images: [OG_IMAGE.url], title: SITE_TITLE },
  applicationName: APP_NAME,
  manifest: '/manifest.webmanifest',
  icons: {
    apple: '/apple-touch-icon.png',
    icon: [
      { type: 'image/svg+xml', url: '/icon.svg' },
      { sizes: '192x192', type: 'image/png', url: '/icon-192.png' },
    ],
  },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: APP_NAME },
  formatDetection: { address: false, email: false, telephone: false },
  referrer: 'no-referrer',
  // ダークモードは OS の設定に追従する(5.5)。Dark Reader などの拡張機能に二重に色を変えさせない
  other: { 'darkreader-lock': 'true' },
};

export const viewport: Viewport = {
  themeColor: [
    { color: '#fafaf9', media: '(prefers-color-scheme: light)' },
    { color: '#0c0a09', media: '(prefers-color-scheme: dark)' },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // 拡張機能が <html> の属性を書き換えても、ハイドレーションの警告を出さない(1段目の属性だけが対象)
    <html lang="ja" suppressHydrationWarning>
      <body className="flex min-h-dvh flex-col font-sans">
        <GaBoundary />
        <AppStateProvider>
          <ToastProvider>
            <SiteHeader />
            <StatusBanner />
            <main className="w-full flex-1 pt-6">{children}</main>
            <SiteFooter />
          </ToastProvider>
        </AppStateProvider>
      </body>
    </html>
  );
}
