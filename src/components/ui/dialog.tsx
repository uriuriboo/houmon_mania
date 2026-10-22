'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * ネイティブの <dialog> を使ったモーダル。フォーカスの閉じ込め・Esc での終了・背景の操作の禁止はブラウザが行う。
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        // 背景(dialog 要素そのもの)をクリックしたら閉じる
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100%-2rem)] rounded-xl bg-white p-0 text-stone-900 shadow-xl dark:bg-stone-900 dark:text-stone-100 ${size === 'lg' ? 'max-w-2xl' : 'max-w-md'}`}
    >
      <div className="flex max-h-[85dvh] flex-col">
        <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4 dark:border-stone-800">
          <h2 id={titleId} className="text-base font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="-m-1 rounded p-1 text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:hover:bg-stone-800 dark:hover:text-stone-100"
          >
            <X className="size-5" aria-hidden />
            <span className="sr-only">閉じる</span>
          </button>
        </div>
        <div className="overflow-y-auto px-5 py-4 text-sm leading-relaxed">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-stone-200 px-5 py-3 dark:border-stone-800">{footer}</div>}
      </div>
    </dialog>
  );
}
