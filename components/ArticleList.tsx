import Link from 'next/link'
import type { ArticleListItem } from '@/lib/articles'
import { createArticleExcerpt } from '@/lib/excerpt'
import { getArticlePath } from '@/lib/site'

type ArticleListProps = {
  articles: ArticleListItem[]
  error?: string | null
  emptyMessage?: string
}

export function ArticleList({
  articles,
  error,
  emptyMessage = '표시할 기사가 없습니다.',
}: ArticleListProps) {
  if (error) {
    return (
      <div className="p-4 border border-red-300 bg-red-50 rounded text-red-700 text-sm">
        기사를 불러오지 못했습니다: {error}
      </div>
    )
  }

  if (articles.length === 0) {
    return <p className="text-zinc-500 py-8">{emptyMessage}</p>
  }

  return (
    <ul>
      {articles.map((article) => (
        <li key={article.id}>
          <Link
            href={getArticlePath(article)}
            className="flex gap-4 py-5 border-b border-zinc-200 group"
          >
            <div className="w-40 h-28 sm:w-48 sm:h-32 flex-shrink-0 overflow-hidden rounded bg-zinc-100">
              {article.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={article.imageUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-xs text-zinc-400">
                  no image
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <CategoryBadges category={article.category} genre={article.genre} />
              <h3 className="text-base sm:text-lg font-semibold leading-snug line-clamp-2 group-hover:underline">
                {article.title}
              </h3>
              <p className="mt-1.5 text-sm text-zinc-600 line-clamp-2">
                {createArticleExcerpt(article.content, undefined, article.content_blocks)}
              </p>
              {article.published_at && (
                <time className="mt-2 block text-xs text-zinc-500">
                  {formatDate(article.published_at)}
                </time>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function PopularList({ articles }: { articles: ArticleListItem[] }) {
  if (articles.length === 0) {
    return <p className="text-sm text-zinc-500">표시할 기사가 없습니다.</p>
  }

  return (
    <ol className="space-y-4">
      {articles.map((article, idx) => (
        <li key={article.id}>
          <Link
            href={getArticlePath(article)}
            className="flex gap-3 group"
          >
            <span className="text-xl font-bold text-zinc-300 w-6 flex-shrink-0 leading-tight">
              {idx + 1}
            </span>
            <span className="text-sm font-medium leading-snug line-clamp-3 group-hover:underline">
              {article.title}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  )
}

function CategoryBadges({
  category,
  genre,
}: {
  category?: string | null
  genre?: string | null
}) {
  if (!category && !genre) return null
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
      {category && (
        <span className="px-2 py-0.5 rounded bg-zinc-900 text-white font-medium">
          {category}
        </span>
      )}
      {genre && (
        <span className="px-2 py-0.5 rounded border border-zinc-300 text-zinc-700">
          {genre}
        </span>
      )}
    </div>
  )
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
