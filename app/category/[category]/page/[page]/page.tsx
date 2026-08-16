import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ArchiveView } from '@/components/ArchiveView'
import { loadArchivePage, loadArchivePageParams } from '@/lib/articles'
import { CATEGORY_NAV, categoryLabel, findCategory } from '@/lib/taxonomy'
import { createArchiveMetadata } from '@/lib/seo'

export const dynamicParams = false

export async function generateStaticParams() {
  const params = await Promise.all(
    CATEGORY_NAV.map(async ({ slug: category }) => {
      const pages = await loadArchivePageParams({ category })
      return pages.map((page) => ({ category, page: String(page) }))
    })
  )
  return params.flat()
}

export async function generateMetadata({ params }: {
  params: Promise<{ category: string; page: string }>
}): Promise<Metadata> {
  const { category, page } = await params
  const label = categoryLabel(category)
  return createArchiveMetadata({
    title: `${categoryLabel(category)} 기사 ${page}페이지 | FEEL THE DROP`,
    description: `FEEL THE DROP의 ${label} 관련 EDM 기사 ${page}페이지입니다.`,
    path: `/category/${category}/page/${page}/`,
  })
}

export default async function CategoryArchivePage({ params }: {
  params: Promise<{ category: string; page: string }>
}) {
  const { category, page: pageParam } = await params
  const page = parsePageNumber(pageParam)
  const known = findCategory(category)
  if (!known || page === null) notFound()

  const label = categoryLabel(category)
  const archive = await loadArchivePage({ category, page })
  if (page > archive.totalPages) notFound()

  return (
    <ArchiveView
      eyebrow="카테고리"
      title={`${label} · ${page}페이지`}
      archive={archive}
      basePath={`/category/${category}`}
      emptyMessage={`${label} 카테고리에 게시된 기사가 아직 없습니다.`}
      breadcrumbs={[
        { name: '홈', path: '/' },
        { name: label, path: `/category/${category}/` },
        { name: `${page}페이지`, path: `/category/${category}/page/${page}/` },
      ]}
    />
  )
}

function parsePageNumber(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const page = Number(value)
  return Number.isSafeInteger(page) && page >= 2 ? page : null
}
