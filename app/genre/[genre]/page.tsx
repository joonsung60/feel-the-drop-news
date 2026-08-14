import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ArchiveView } from '@/components/ArchiveView'
import { loadArchivePage } from '@/lib/articles'
import { RELEASE_GENRE_NAV, findGenre, genreLabel } from '@/lib/taxonomy'

export const dynamicParams = false

export async function generateStaticParams() {
  const slugs = new Set([
    ...RELEASE_GENRE_NAV.map((item) => item.slug),
  ])

  return Array.from(slugs).map((genre) => ({ genre }))
}

export async function generateMetadata({ params }: {
  params: Promise<{ genre: string }>
}): Promise<Metadata> {
  const { genre } = await params
  const label = genreLabel(genre)
  return {
    title: `${label} 릴리즈 | FEEL THE DROP`,
    alternates: { canonical: `/genre/${genre}/` },
  }
}

export default async function GenrePage({
  params,
}: {
  params: Promise<{ genre: string }>
}) {
  const { genre } = await params
  const known = findGenre(genre)
  const label = genreLabel(genre)
  if (!known) notFound()

  const archive = await loadArchivePage({
    category: 'release',
    genre,
    page: 1,
  })

  return (
    <ArchiveView
      eyebrow="장르"
      title={label}
      archive={archive}
      basePath={`/genre/${genre}`}
      emptyMessage={`${label} 릴리즈 기사가 아직 없습니다.`}
    />
  )
}
