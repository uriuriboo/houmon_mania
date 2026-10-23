import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';
import { TRADEMARK_NOTICE, UNOFFICIAL_NOTICE } from '@/lib/legal';

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-stone-200 py-8 text-xs text-stone-600 dark:border-stone-800 dark:text-stone-400">
      <div className="mx-auto max-w-3xl space-y-3 px-4">
        <p className="flex items-center gap-2 font-medium text-stone-700 dark:text-stone-300">
          <ShieldCheck className="size-4 shrink-0" aria-hidden />
          データはこの端末の中だけに保存され、送信されません。
        </p>
        <p className="leading-relaxed">
          {UNOFFICIAL_NOTICE}
          {TRADEMARK_NOTICE}
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/about">このアプリについて</Link>
          <Link href="/privacy">プライバシーポリシー</Link>
          <Link href="/data">データ管理</Link>
        </p>
      </div>
    </footer>
  );
}
