'use client';

import { FileArchive, FileJson, FolderOpen } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { buttonClasses } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { isExportDataPath } from '@/lib/export/files';
import type { ImportInput } from '@/lib/workers/protocol';

const isZip = (f: File) => /\.zip$/iu.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';
const isJson = (f: File) => /\.json$/iu.test(f.name);

/**
 * エクスポートの選び方(9.2.2): ZIP(標準)、展開済みのフォルダ、JSON ファイルの直接選択。
 * フォルダの中のファイルは名前だけで絞り込み、checkins*.json と photos*.json 以外はワーカーに渡さない(P-4)。
 */
export function FilePicker({ onSelect, disabled }: { onSelect: (input: ImportInput) => void; disabled?: boolean }) {
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  // webkitdirectory は React の型定義に無いため、要素に直接設定する
  useEffect(() => {
    if (folderRef.current) folderRef.current.webkitdirectory = true;
  }, []);

  const pickZip = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onSelect({ file: f, kind: 'zip' });
  };
  const pickFolder = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files)
      .map((file) => ({ file, path: file.webkitRelativePath || file.name }))
      .filter((f) => isExportDataPath(f.path));
    onSelect({ files: list, kind: 'folder' });
  };
  const pickJson = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    onSelect({ files: Array.from(files).map((file) => ({ file, path: file.name })), kind: 'files' });
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 1 && isZip(files[0]!)) {
      setDropError(null);
      onSelect({ file: files[0]!, kind: 'zip' });
    } else if (files.length > 0 && files.every(isJson)) {
      setDropError(null);
      onSelect({ files: files.map((file) => ({ file, path: file.name })), kind: 'files' });
    } else {
      setDropError('ここに置けるのは、ZIP ファイル1つか JSON ファイルです。フォルダは「展開済みのフォルダを選択」から選んでください。');
    }
  };

  const inputClass = 'sr-only';
  const labelClass = (variant: 'primary' | 'secondary') =>
    buttonClasses(variant, 'lg', `cursor-pointer ${disabled ? 'pointer-events-none opacity-60' : ''} focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-orange-600`);

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`rounded-xl border-2 border-dashed p-5 transition-colors ${dragging ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/30' : 'border-stone-300 dark:border-stone-700'}`}
      >
        <div className="flex flex-wrap gap-3">
          <label className={labelClass('primary')}>
            <FileArchive className="size-5" aria-hidden />
            ZIP を選択
            <input
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              className={inputClass}
              disabled={disabled}
              onChange={(e) => {
                pickZip(e.currentTarget.files);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <label className={labelClass('secondary')}>
            <FolderOpen className="size-5" aria-hidden />
            展開済みのフォルダを選択
            <input
              ref={folderRef}
              type="file"
              multiple
              className={inputClass}
              disabled={disabled}
              onChange={(e) => {
                pickFolder(e.currentTarget.files);
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>
        <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
          ZIP のまま選べます(写真が入っていて大きくても大丈夫です)。ここにドラッグ&ドロップもできます。
        </p>
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-stone-600 dark:text-stone-400">JSON ファイルを直接選ぶ</summary>
          <div className="mt-2 space-y-2">
            <p className="text-stone-600 dark:text-stone-400">
              checkins1.json などと photos1.json を、まとめて選んでください。この方法では、エクスポート全体がそろっているか確かめられないため、Swarm で削除したチェックインの反映はできません。
            </p>
            <label className={buttonClasses('secondary', 'sm', `cursor-pointer ${disabled ? 'pointer-events-none opacity-60' : ''}`)}>
              <FileJson className="size-4" aria-hidden />
              JSON ファイルを選択
              <input
                type="file"
                accept=".json,application/json"
                multiple
                className={inputClass}
                disabled={disabled}
                onChange={(e) => {
                  pickJson(e.currentTarget.files);
                  e.currentTarget.value = '';
                }}
              />
            </label>
          </div>
        </details>
      </div>
      {dropError && (
        <Notice tone="error" role="alert">
          {dropError}
        </Notice>
      )}
    </div>
  );
}
