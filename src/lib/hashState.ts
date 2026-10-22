/**
 * 検索画面の状態を URL の # 以降に持つ(5.6、8.1、P-1)。# 以降はサーバーに送られない。
 * 値は検証し、不正な値は既定値にする。
 */
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, QUERY_LIMITS } from '@/lib/constants';

export type SearchHashState = {
  q: string;
  page: number;
  size: number;
  /** 詳細を開いているチェックインの ID */
  id: string | null;
};

export const MAX_PAGE = 100_000;
const HEX24 = /^[0-9a-f]{24}$/u;

export const parseSearchHash = (hash: string): SearchHashState => {
  const params = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  // 長すぎる検索式は、検索せずに上限超過のエラーを出せるよう少しだけ余分に残す
  const q = (params.get('q') ?? '').slice(0, QUERY_LIMITS.maxLength * 2 + 10);
  const pageRaw = params.get('page');
  const page = pageRaw !== null && /^\d{1,6}$/u.test(pageRaw) ? Math.min(Math.max(Number(pageRaw), 1), MAX_PAGE) : 1;
  const sizeRaw = Number(params.get('size'));
  const size = (PAGE_SIZES as readonly number[]).includes(sizeRaw) ? sizeRaw : DEFAULT_PAGE_SIZE;
  const idRaw = params.get('id');
  const id = idRaw !== null && HEX24.test(idRaw) ? idRaw : null;
  return { id, page, q, size };
};

export const buildSearchHash = (state: SearchHashState): string => {
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.page > 1) params.set('page', String(state.page));
  if (state.size !== DEFAULT_PAGE_SIZE) params.set('size', String(state.size));
  if (state.id) params.set('id', state.id);
  const s = params.toString();
  return s ? `#${s}` : '';
};
