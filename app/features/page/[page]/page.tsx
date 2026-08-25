import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ArchiveView } from '@/components/ArchiveView'
import { loadFeatureArchivePage, loadFeatureArchivePageParams } from '@/lib/article-features'
import { createArchiveMetadata } from '@/lib/seo'

export const dynamicParams = false
export const dynamic = 'force-static'

export async function generateStaticParams() {
  const pages = await loadFeatureArchivePageParams()
  // Next.js 16.2.6 output:export rejects a dynamic segment when this returns
  // an empty array, despite the documented contract. Build one not-found
  // sentinel so collections with <= 50 items can still export safely.
  return (pages.length > 0 ? pages : [2]).map((page) => ({ page: String(page) }))
}

export async function generateMetadata({ params }: {
  params: Promise<{ page: string }>
}): Promise<Metadata> {
  const { page } = await params
  return createArchiveMetadata({
    title: `특집 기사 ${page}페이지 | FEEL THE DROP`,
    description: `FEEL THE DROP 특집 기사 ${page}페이지입니다.`,
    path: `/features/page/${page}/`,
  })
}

export default async function FeaturesPage({ params }: {
  params: Promise<{ page: string }>
}) {
  const { page: pageParam } = await params
  const page = parsePageNumber(pageParam)
  if (page === null) notFound()
  const archive = await loadFeatureArchivePage({ page })
  if (page > archive.totalPages) notFound()
  return <ArchiveView
    eyebrow="Feature"
    title={`특집 기사 · ${page}페이지`}
    archive={archive}
    basePath="/features"
    emptyMessage="현재 공개된 특집 기사가 없습니다."
    breadcrumbs={[
      { name: '홈', path: '/' },
      { name: '특집', path: '/features/' },
      { name: `${page}페이지`, path: `/features/page/${page}/` },
    ]}
  />
}

function parsePageNumber(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const page = Number(value)
  return Number.isSafeInteger(page) && page >= 2 ? page : null
}
