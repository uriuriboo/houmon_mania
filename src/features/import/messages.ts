/**
 * 取り込みのエラー・警告の文言(9.2.6)。「何が起きたか」と「どうすればよいか」をセットで示す(5.5)。
 */
import { formatCount } from '@/components/ui/misc';
import { LIMITS } from '@/lib/constants';
import type { AnalysisWarning } from '@/lib/import/analyze';
import type { DeletionBlockReason } from '@/lib/import/diff';
import type { ImportErrorCode } from '@/lib/import/errors';

export const IMPORT_ERROR_MESSAGES: Record<ImportErrorCode, { title: string; action: string }> = {
  BUSY: { action: '別のタブでの取り込み・削除が終わってから、やり直してください。', title: '別のタブで処理中です' },
  CANCELLED: { action: 'もう一度読み込むと、続きから取り込めます(重複はしません)。', title: '中止しました' },
  DB_CLOSED: { action: '再読み込みしてから、もう一度読み込んでください。', title: '別のタブでデータが削除されたため、中断しました' },
  FORMAT: {
    action: 'Foursquare から届いたファイルかどうか確かめてください。エクスポートの形式が変わった可能性もあります。解決しない場合は、下のエラーの種類を添えてお知らせください。',
    title: 'エクスポートの形式が想定と違います',
  },
  INTERRUPTED: { action: 'もう一度読み込んでください。取り込み中は、この画面を開いたままにしてください。', title: '取り込みが中断されました' },
  MULTIPLE_EXPORTS: { action: 'エクスポートを1つずつ選んでください。', title: '複数のエクスポートが含まれています' },
  NOT_ZIP: {
    action: 'Foursquare から届いた ZIP ファイルを選んでください。自動で展開された場合は「展開済みのフォルダを選択」を使ってください。',
    title: 'ZIP ファイルではありません',
  },
  NO_ANALYSIS: { action: 'もう一度ファイルを選んでください。', title: '分析結果が見つかりません' },
  NO_EXPORT_FILES: {
    action: 'Foursquare から届いた ZIP ファイル(中に checkins1.json などが入っているもの)か、それを展開したフォルダを選んでください。',
    title: 'エクスポートのファイルが見つかりません',
  },
  QUOTA: { action: '端末の空き容量を増やしてから、もう一度読み込んでください。保存済みの分は残っています。', title: '保存領域の空き容量が足りません' },
  READ_FAILED: {
    action: 'ファイルを選び直してください。クラウドストレージ上のファイルは、端末にダウンロードしてから選んでください。',
    title: 'ファイルを読み込めませんでした',
  },
  STORAGE_UNAVAILABLE: {
    action: 'プライベートブラウズをやめるか、ブラウザの設定でこのサイトのデータの保存を許可してください。',
    title: 'ブラウザの保存領域を使えません',
  },
  TOO_LARGE: { action: '端末が固まるのを防ぐため、大きすぎるファイルは読み込みません。', title: 'ファイルが大きすぎます' },
  TOO_MANY_FILES: { action: '端末が固まるのを防ぐため、ファイルが多すぎる ZIP は読み込みません。', title: 'ZIP の中のファイルが多すぎます' },
  TOO_MANY_RECORDS: {
    action: `1つのブラウザに保存できるのは、チェックイン ${formatCount(LIMITS.maxCheckins)} 件・写真の情報 ${formatCount(LIMITS.maxPhotos)} 件までです。`,
    title: '件数が多すぎます',
  },
  UNKNOWN: { action: '再読み込みしてから、もう一度お試しください。', title: '予期しないエラーが発生しました' },
  ZIP_CORRUPT: { action: 'ZIP ファイルが途中までしかダウンロードできていない可能性があります。ダウンロードし直してください。', title: 'ZIP ファイルが壊れています' },
  ZIP_ENCRYPTED: { action: 'パスワードの無い ZIP ファイルを選んでください。', title: 'パスワード付きの ZIP には対応していません' },
  ZIP_UNSUPPORTED: { action: '展開してから「展開済みのフォルダを選択」で選んでください。', title: 'この ZIP の形式には対応していません' },
};

export const warningMessage = (w: AnalysisWarning): { tone: 'info' | 'warning'; text: string } => {
  switch (w.code) {
    case 'INCOMPLETE_FILES':
      return {
        text: `エクスポートの一部のファイルが見つかりません${w.missing.length ? `(${w.missing.join('、')})` : ''}。取り込みはできますが、削除の反映はできません。`,
        tone: 'warning',
      };
    case 'COUNT_MISMATCH':
      return { text: `ファイルの中の件数が合いません(${w.files.join('、')})。取り込みはできますが、削除の反映はできません。`, tone: 'warning' };
    case 'NO_PHOTOS_FILE':
      return { text: '写真の情報(photos*.json)が見つかりません。写真は表示されません。', tone: 'info' };
    case 'INVALID_RECORDS':
      return { text: `形式が正しくないチェックイン ${formatCount(w.count)} 件を除外しました。残りは取り込めます。`, tone: 'warning' };
    case 'DUPLICATES':
      return { text: `同じチェックインが重複していた ${formatCount(w.count)} 件を、1件にまとめました。`, tone: 'info' };
    case 'PHOTOS_SKIPPED':
      return { text: `チェックインに対応しない写真の情報 ${formatCount(w.count)} 件は取り込みません(ヒントなどに付けた写真)。`, tone: 'info' };
    case 'UNKNOWN_KEYS':
      return {
        text: `このアプリが知らない項目がありました(${w.keys.join('、')})。エクスポートの形式が変わった可能性があります。取り込みには影響しません。`,
        tone: 'info',
      };
  }
};

export const DELETION_BLOCK_MESSAGES: Record<DeletionBlockReason, string> = {
  INCOMPLETE_FILES: 'エクスポートのファイルに欠けがあるか、件数が合いません。',
  NOT_FULL_EXPORT: 'JSON ファイルを直接選んだため、エクスポート全体がそろっているか確かめられません。',
  PERIOD_NOT_COVERED: 'このエクスポートの期間が、保存済みのデータの期間を覆っていません(古いエクスポートか、一部だけのエクスポートの可能性があります)。',
  TOO_MANY_DELETIONS: '件数が多すぎます(誤操作を防ぐため、保存件数の 5% か 20 件の多い方までにしています)。',
  UNIDENTIFIED_RECORDS: 'ID を読み取れないチェックインがありました。',
};
