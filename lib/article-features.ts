import { supabase } from '@/lib/supabase'
import { loadPublishedArticlesByIds, type ArticleListItem } from '@/lib/articles'

export type FeatureCandidate = {
  article: ArticleListItem
  featuredAt: string
}

type FeatureRow = { article_id: string; featured_at: string }

export async function loadFeatureArticleIds(ids: string[]): Promise<{
  articleIds: Set<string>
  error: string | null
}> {
  const uniqueIds = Array.from(new Set(ids))
  if (uniqueIds.length === 0) return { articleIds: new Set(), error: null }
  const { data, error } = await supabase
    .from('article_features')
    .select('article_id')
    .in('article_id', uniqueIds)
  if (error) return { articleIds: new Set(), error: error.message }
  return {
    articleIds: new Set(((data ?? []) as Pick<FeatureRow, 'article_id'>[]).map((row) => row.article_id)),
    error: null,
  }
}

export async function loadPublishedFeatureCandidates(limit = 10): Promise<{
  features: FeatureCandidate[]
  error: string | null
}> {
  const { data, error } = await supabase
    .from('article_features')
    .select('article_id, featured_at, articles!inner(id)')
    .eq('articles.published', true)
    .order('featured_at', { ascending: false })
    .order('article_id', { ascending: true })
    .limit(limit)
  if (error) return { features: [], error: error.message }

  const rows = (data ?? []) as FeatureRow[]
  const loaded = await loadPublishedArticlesByIds(rows.map((row) => row.article_id))
  if (loaded.error) return { features: [], error: loaded.error }
  const articleById = new Map(loaded.articles.map((article) => [article.id, article]))
  return {
    features: rows.flatMap((row) => {
      const article = articleById.get(row.article_id)
      return article ? [{ article, featuredAt: row.featured_at }] : []
    }),
    error: null,
  }
}

export async function loadFeatureArchivePage(options: { page: number; pageSize?: number }) {
  const pageSize = options.pageSize ?? 50
  const from = (options.page - 1) * pageSize
  const { data, error, count } = await supabase
    .from('article_features')
    .select('article_id, featured_at, articles!inner(id)', { count: 'exact' })
    .eq('articles.published', true)
    .order('featured_at', { ascending: false })
    .order('article_id', { ascending: true })
    .range(from, from + pageSize - 1)

  if (error) return emptyArchive(options.page, error.message)
  const rows = (data ?? []) as FeatureRow[]
  const loaded = await loadPublishedArticlesByIds(rows.map((row) => row.article_id))
  if (loaded.error) return emptyArchive(options.page, loaded.error)
  const articleById = new Map(loaded.articles.map((article) => [article.id, article]))
  const articles = rows.flatMap((row) => {
    const article = articleById.get(row.article_id)
    return article ? [article] : []
  })
  const totalItems = count ?? 0
  return {
    articles,
    error: null,
    page: options.page,
    totalItems,
    totalPages: Math.ceil(totalItems / pageSize),
  }
}

export async function loadFeatureArchivePageParams(pageSize = 50): Promise<number[]> {
  const { count, error } = await supabase
    .from('article_features')
    .select('article_id, articles!inner(id)', { count: 'exact', head: true })
    .eq('articles.published', true)
  if (error) {
    console.warn('[Feature Archive] 페이지 수 조회 실패, 추가 정적 페이지를 생략합니다:', error.message)
    return []
  }
  const totalPages = Math.ceil((count ?? 0) / pageSize)
  return Array.from({ length: Math.max(totalPages - 1, 0) }, (_, index) => index + 2)
}

function emptyArchive(page: number, error: string) {
  return { articles: [], error, page, totalItems: 0, totalPages: 0 }
}
