import type { Metadata } from 'next';
import { PageContainer, PageTitle } from '@/components/ui/misc';
import { StorageGate } from '@/features/app/StorageGate';
import { ImportView } from '@/features/import/ImportView';

export const metadata: Metadata = { robots: { follow: false, index: false }, title: 'データの取り込み' };

export default function ImportPage() {
  return (
    <PageContainer>
      <PageTitle>データの取り込み</PageTitle>
      <StorageGate>
        <ImportView />
      </StorageGate>
    </PageContainer>
  );
}
