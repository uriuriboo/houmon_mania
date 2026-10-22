'use client';

import Link from 'next/link';
import { Menu, RefreshCw } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/logo';
import { useAppState } from '@/features/app/AppStateProvider';
import { APP_NAME } from '@/lib/constants';
import { formatDeviceShortDate, formatLocalShortDate } from '@/lib/datetime';

const MENU = [
  { href: '/search', label: '検索' },
  { href: '/import', label: 'データの取り込み・更新' },
  { href: '/data', label: 'データ管理' },
  { href: '/about', label: 'このアプリについて' },
  { href: '/privacy', label: 'プライバシーポリシー' },
] as const;

export function SiteHeader() {
  const { meta, status } = useAppState();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 画面を移ったらメニューを閉じる(描画中の状態の更新で行う)
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const hasData = status === 'ready' && meta.checkinCount > 0;

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-stone-200 bg-stone-50/95 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95">
      <div className="mx-auto flex h-full max-w-6xl items-center gap-3 px-4">
        <Link href="/search" className="flex items-center gap-2 text-lg font-bold text-stone-900 no-underline hover:no-underline dark:text-stone-100">
          <Logo />
          {APP_NAME}
        </Link>

        <div className="ml-auto flex items-center gap-1 sm:gap-3">
          {hasData && meta.latestCheckinAt !== null && meta.lastImportedAt !== null && (
            <p className="hidden text-xs text-stone-600 md:block dark:text-stone-400">
              最新チェックイン {formatLocalShortDate(meta.latestCheckinAt, meta.latestCheckinTz)}・取り込み {formatDeviceShortDate(meta.lastImportedAt)}
            </p>
          )}
          {hasData && (
            <Link
              href="/import"
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-stone-700 no-underline hover:bg-stone-200/70 hover:no-underline dark:text-stone-300 dark:hover:bg-stone-800"
            >
              <RefreshCw className="size-4" aria-hidden />
              <span className="hidden sm:inline">データを更新</span>
              <span className="sr-only sm:hidden">データを更新</span>
            </Link>
          )}
          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-expanded={open}
              aria-controls="site-menu"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center rounded-lg p-2 text-stone-700 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              <Menu className="size-5" aria-hidden />
              <span className="sr-only">メニュー</span>
            </button>
            {open && (
              <nav
                id="site-menu"
                aria-label="メニュー"
                className="absolute right-0 mt-2 w-56 overflow-hidden rounded-lg border border-stone-200 bg-white py-1 shadow-lg dark:border-stone-700 dark:bg-stone-900"
              >
                <ul>
                  {MENU.map((m) => (
                    <li key={m.href}>
                      <Link
                        href={m.href}
                        aria-current={pathname === m.href ? 'page' : undefined}
                        className="block px-4 py-2.5 text-sm text-stone-800 no-underline hover:bg-stone-100 hover:no-underline aria-[current=page]:font-bold dark:text-stone-200 dark:hover:bg-stone-800"
                      >
                        {m.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
