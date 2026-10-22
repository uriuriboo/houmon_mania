'use client';

import { Button } from '@/components/ui/button';
import { PageContainer } from '@/components/ui/misc';
import { Notice } from '@/components/ui/notice';

/** 画面単位の予期しないエラー(9.7)。技術的な詳細は出さず、再読み込みを案内する */
export default function ErrorPage() {
  return (
    <PageContainer>
      <Notice tone="error" title="予期しないエラーが発生しました" role="alert">
        <p>再読み込みしてください。保存したデータはそのまま残っています。</p>
        <p className="text-xs opacity-80">エラーの種類: E-APP-UNEXPECTED</p>
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => window.location.reload()}>
          再読み込み
        </Button>
      </Notice>
    </PageContainer>
  );
}
