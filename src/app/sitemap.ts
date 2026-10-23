import type { MetadataRoute } from 'next';
import { PUBLIC_PATHS, SITE_URL } from '@/lib/constants';

// 静的書き出し(output: 'export')では、この指定が必要
export const dynamic = 'force-static';

/** 位置履歴を扱わない 3 ページだけを載せる。静的に書き出す(サーバー側の処理は持たない) */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map((path) => ({ url: path === '/' ? SITE_URL : `${SITE_URL}${path}` }));
}
