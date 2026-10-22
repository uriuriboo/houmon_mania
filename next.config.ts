import type { NextConfig } from 'next';

// 静的書き出しのみ(サーバー側の処理は持たない。基本設計 P-2)。
// ヘッダは Vercel(vercel.json)と、ビルド後に各 HTML へ埋め込む meta の CSP(scripts/inject-csp.mjs)で付ける(10.2、17章 D-11)。
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
  productionBrowserSourceMaps: false,
};

export default nextConfig;
