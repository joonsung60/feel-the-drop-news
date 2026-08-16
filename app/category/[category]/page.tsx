import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ArchiveView } from '@/components/ArchiveView'
import { loadArchivePage } from '@/lib/articles'
import { CATEGORY_NAV, categoryLabel, findCategory } from '@/lib/taxonomy'
import { createArchiveMetadata } from '@/lib/seo'

export const dynamicParams = false

export async function generateStaticParams() {
  return CATEGORY_NAV.map(({ slug: category }) => ({ category }))
}

export async function generateMetadata({ params }: {
  params: Promise<{ category: string }>
}): Promise<Metadata> {
  const { category } = await params
  const label = categoryLabel(category)
  return createArchiveMetadata({
    title: `${label} 기사 | FEEL THE DROP`,
    description: `FEEL THE DROP의 ${label} 관련 EDM 기사와 소식을 확인하세요.`,
    path: `/category/${category}/`,
  })
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ category: string }>
}) {
  const { category } = await params
  const known = findCategory(category)
  const label = categoryLabel(category)
  if (!known) notFound()

  const archive = await loadArchivePage({
    category,
    page: 1,
  })

  return (
    <ArchiveView
      eyebrow="카테고리"
      title={label}
      archive={archive}
      basePath={`/category/${category}`}
      emptyMessage={`${label} 카테고리에 게시된 기사가 아직 없습니다.`}
      breadcrumbs={[
        { name: '홈', path: '/' },
        { name: label, path: `/category/${category}/` },
      ]}
    />
  )
}
