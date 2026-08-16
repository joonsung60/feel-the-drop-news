import Link from 'next/link'
import { ArticleList } from '@/components/ArticleList'
import { JsonLd } from '@/components/JsonLd'
import type { ArchivePageResult } from '@/lib/articles'
import { createBreadcrumbJsonLd, type BreadcrumbItem } from '@/lib/seo'

type ArchiveViewProps = {
  eyebrow: string
  title: string
  archive: ArchivePageResult
  basePath: string
  emptyMessage: string
  breadcrumbs: BreadcrumbItem[]
}

export function ArchiveView({
  eyebrow,
  title,
  archive,
  basePath,
  emptyMessage,
  breadcrumbs,
}: ArchiveViewProps) {
  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <JsonLd data={createBreadcrumbJsonLd(breadcrumbs)} />
      <header className="mb-6 border-b-2 border-zinc-900 pb-3">
        <p className="text-sm font-medium text-zinc-500">{eyebrow}</p>
        <h1 className="mt-1 text-2xl font-bold">{title}</h1>
      </header>

      <ArticleList
        articles={archive.articles}
        error={archive.error}
        emptyMessage={emptyMessage}
      />

      {archive.totalPages > 1 && (
        <ArchivePagination
          basePath={basePath}
          currentPage={archive.page}
          totalPages={archive.totalPages}
        />
      )}
    </div>
  )
}

function ArchivePagination({
  basePath,
  currentPage,
  totalPages,
}: {
  basePath: string
  currentPage: number
  totalPages: number
}) {
  return (
    <nav aria-label="페이지 탐색" className="mt-10 flex flex-wrap items-center justify-center gap-2">
      {currentPage > 1 && (
        <Link href={pageHref(basePath, currentPage - 1)} className="px-3 py-2 text-sm border border-zinc-300 hover:border-zinc-900">
          이전
        </Link>
      )}

      {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
        <Link
          key={page}
          href={pageHref(basePath, page)}
          aria-current={page === currentPage ? 'page' : undefined}
          className={`min-w-10 px-3 py-2 text-center text-sm border ${
            page === currentPage
              ? 'border-zinc-900 bg-zinc-900 text-white'
              : 'border-zinc-300 hover:border-zinc-900'
          }`}
        >
          {page}
        </Link>
      ))}

      {currentPage < totalPages && (
        <Link href={pageHref(basePath, currentPage + 1)} className="px-3 py-2 text-sm border border-zinc-300 hover:border-zinc-900">
          다음
        </Link>
      )}
    </nav>
  )
}

export function pageHref(basePath: string, page: number): string {
  return page === 1 ? `${basePath}/` : `${basePath}/page/${page}/`
}
