import type { Metadata } from 'next'
import { ArchiveView } from '@/components/ArchiveView'
import { loadArchivePage } from '@/lib/articles'
import { createArchiveMetadata } from '@/lib/seo'

export const metadata: Metadata = createArchiveMetadata({
  title: '전체 기사 아카이브 | FEEL THE DROP',
  description: 'FEEL THE DROP의 전체 EDM 뉴스와 전자음악 기사 아카이브입니다.',
  path: '/archive/',
})

export default async function AllArticlesArchivePage() {
  const archive = await loadArchivePage({ page: 1 })

  return (
    <ArchiveView
      eyebrow="아카이브"
      title="전체 기사"
      archive={archive}
      basePath="/archive"
      emptyMessage="게시된 기사가 아직 없습니다."
      breadcrumbs={[
        { name: '홈', path: '/' },
        { name: '전체 기사', path: '/archive/' },
      ]}
    />
  )
}
