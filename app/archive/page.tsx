import type { Metadata } from 'next'
import { ArchiveView } from '@/components/ArchiveView'
import { loadArchivePage } from '@/lib/articles'

export const metadata: Metadata = {
  title: '전체 기사 아카이브 | FEEL THE DROP',
  alternates: { canonical: '/archive/' },
}

export default async function AllArticlesArchivePage() {
  const archive = await loadArchivePage({ page: 1 })

  return (
    <ArchiveView
      eyebrow="아카이브"
      title="전체 기사"
      archive={archive}
      basePath="/archive"
      emptyMessage="게시된 기사가 아직 없습니다."
    />
  )
}
