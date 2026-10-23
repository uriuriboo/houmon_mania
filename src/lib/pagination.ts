/**
 * ページネーション(5.6)。
 */

export const totalPages = (total: number, size: number): number => Math.max(1, Math.ceil(total / size));

/** 範囲外のページは最終ページに補正する(0件なら1ページ目) */
export const clampPage = (page: number, total: number, size: number): number =>
  Math.min(Math.max(1, Math.floor(page)), totalPages(total, size));

export type PageSlot = number | 'ellipsis-start' | 'ellipsis-end';

/**
 * PC のページ番号の並び(最大7枠)。例: 1 … 4 [5] 6 … 25
 */
export const pageSlots = (current: number, pages: number): PageSlot[] => {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, 'ellipsis-end', pages];
  if (current >= pages - 3) return [1, 'ellipsis-start', pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, 'ellipsis-start', current - 1, current, current + 1, 'ellipsis-end', pages];
};

/** 「1,234件中 51–100件」の範囲 */
export const pageRange = (page: number, size: number, total: number): { from: number; to: number } => {
  if (total === 0) return { from: 0, to: 0 };
  return { from: (page - 1) * size + 1, to: Math.min(total, page * size) };
};
