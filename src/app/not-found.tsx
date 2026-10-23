import Link from 'next/link';
import { buttonClasses } from '@/components/ui/button';
import { PageContainer, PageTitle } from '@/components/ui/misc';

export default function NotFound() {
  return (
    <PageContainer>
      <PageTitle>ページが見つかりません</PageTitle>
      <p className="mb-6 text-stone-700 dark:text-stone-300">URL が間違っているか、ページが移動した可能性があります。</p>
      <Link href="/" className={buttonClasses('secondary')}>
        トップへ
      </Link>
    </PageContainer>
  );
}
