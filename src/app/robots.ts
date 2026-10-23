import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/constants';

// 静的書き出し(output: 'export')では、この指定が必要
export const dynamic = 'force-static';

/** 位置履歴を扱うページは、検索エンジンに載せない(sitemap.ts の PUBLIC_PATHS と対) */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: ['/search', '/import', '/data'] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
