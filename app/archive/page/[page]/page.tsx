import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ArchiveView } from '@/components/ArchiveView'
import { loadArchivePage, loadArchivePageParams } from '@/lib/articles'
import { createArchiveMetadata } from '@/lib/seo'

export const dynamicParams = false

export async function generateStaticParams() {
  const pages = await loadArchivePageParams()
  return pages.map((page) => ({ page: String(page) }))
}

export async function generateMetadata({ params }: {
  params: Promise<{ page: string }>
}): Promise<Metadata> {
  const { page } = await params
  return createArchiveMetadata({
    title: `전체 기사 아카이브 ${page}페이지 | FEEL THE DROP`,
    description: `FEEL THE DROP 전체 기사 아카이브 ${page}페이지입니다.`,
    path: `/archive/page/${page}/`,
  })
}

export default async function AllArticlesArchivePage({ params }: {
  params: Promise<{ page: string }>
}) {
  const { page: pageParam } = await params
  const page = parsePageNumber(pageParam)
  if (page === null) notFound()

  const archive = await loadArchivePage({ page })
  if (page > archive.totalPages) notFound()

  return (
    <ArchiveView
      eyebrow="아카이브"
      title={`전체 기사 · ${page}페이지`}
      archive={archive}
      basePath="/archive"
      emptyMessage="게시된 기사가 아직 없습니다."
      breadcrumbs={[
        { name: '홈', path: '/' },
        { name: '전체 기사', path: '/archive/' },
        { name: `${page}페이지`, path: `/archive/page/${page}/` },
      ]}
    />
  )
}

function parsePageNumber(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const page = Number(value)
  return Number.isSafeInteger(page) && page >= 2 ? page : null
}
