import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ArchiveView } from '@/components/ArchiveView'
import { loadArchivePage, loadArchivePageParams } from '@/lib/articles'
import { RELEASE_GENRE_NAV, findGenre, genreLabel } from '@/lib/taxonomy'
import { createArchiveMetadata } from '@/lib/seo'

export const dynamicParams = false

export async function generateStaticParams() {
  const params = await Promise.all(
    RELEASE_GENRE_NAV.map(async ({ slug: genre }) => {
      const pages = await loadArchivePageParams({ category: 'release', genre })
      return pages.map((page) => ({ genre, page: String(page) }))
    })
  )
  return params.flat()
}

export async function generateMetadata({ params }: {
  params: Promise<{ genre: string; page: string }>
}): Promise<Metadata> {
  const { genre, page } = await params
  const label = genreLabel(genre)
  return createArchiveMetadata({
    title: `${genreLabel(genre)} 릴리즈 ${page}페이지 | FEEL THE DROP`,
    description: `FEEL THE DROP의 ${label} 릴리즈 기사 ${page}페이지입니다.`,
    path: `/genre/${genre}/page/${page}/`,
  })
}

export default async function GenreArchivePage({ params }: {
  params: Promise<{ genre: string; page: string }>
}) {
  const { genre, page: pageParam } = await params
  const page = parsePageNumber(pageParam)
  const known = findGenre(genre)
  if (!known || page === null) notFound()

  const label = genreLabel(genre)
  const archive = await loadArchivePage({ category: 'release', genre, page })
  if (page > archive.totalPages) notFound()

  return (
    <ArchiveView
      eyebrow="장르"
      title={`${label} · ${page}페이지`}
      archive={archive}
      basePath={`/genre/${genre}`}
      emptyMessage={`${label} 릴리즈 기사가 아직 없습니다.`}
      breadcrumbs={[
        { name: '홈', path: '/' },
        { name: label, path: `/genre/${genre}/` },
        { name: `${page}페이지`, path: `/genre/${genre}/page/${page}/` },
      ]}
    />
  )
}

function parsePageNumber(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const page = Number(value)
  return Number.isSafeInteger(page) && page >= 2 ? page : null
}
