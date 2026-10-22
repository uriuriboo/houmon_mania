import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { ToastProvider } from '@/components/ui/toast';
import { AppStateProvider } from '@/features/app/AppStateProvider';
import { StatusBanner } from '@/features/app/StatusBanner';
import { APP_NAME, APP_NAME_JA } from '@/lib/constants';
import './globals.css';

export const metadata: Metadata = {
  title: { default: `${APP_NAME}(${APP_NAME_JA})`, template: `%s | ${APP_NAME}` },
  description:
    'Swarm のチェックイン履歴を、公式のデータエクスポートから読み込み、店名やコメントで検索できる非公式ツール。データはブラウザの中だけに保存し、送信しません。',
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
