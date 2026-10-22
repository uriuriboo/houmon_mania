import type { Metadata } from 'next';
import { PageContainer, PageTitle } from '@/components/ui/misc';
import { StorageGate } from '@/features/app/StorageGate';
import { DataView } from '@/features/data/DataView';

export const metadata: Metadata = { robots: { follow: false, index: false }, title: 'データ管理' };

export default function DataPage() {
  return (
    <PageContainer>
      <PageTitle>データ管理</PageTitle>
      <StorageGate>
        <DataView />
      </StorageGate>
    </PageContainer>
  );
}
