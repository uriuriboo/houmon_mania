import type { NextConfig } from 'next';

// 静的書き出しのみ(サーバー側の処理は持たない。基本設計 P-2)。
// ヘッダは Netlify(netlify.toml と、ビルド後に生成する out/_headers)で付ける(10.2)。
const nextConfig: NextConfig = {
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
  productionBrowserSourceMaps: false,
};

export default nextConfig;
