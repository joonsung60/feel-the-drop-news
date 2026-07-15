import { supabase } from '@/lib/supabase'
import {
  matchesCategory,
  matchesGenre,
  normalizeTaxonomySlug,
} from '@/lib/taxonomy'

export type ArticleListItem = {
  id: string
  slug: string | null
  title: string
  content: string
  published_at: string | null
  cluster_id: string | null
  article_image_url: string | null
  imageUrl: string | null
  category: string | null
  genre: string | null
}

type ArticleRow = {
  id: string
  slug: string | null
  title: string
  content: string
  published_at: string | null
  cluster_id: string | null
  image_url: string | null
  category: string | null
  genre: string | null
}

type ClusterArticleRow = {
  cluster_id: string
  raw_article_id: string
}

type RawArticleImageRow = {
  id: string
  image_url: string | null
}

type LoadArticlesOptions = {
  limit?: number
  category?: string
  genre?: string
}

type ArticleViewRow = {
  slug: string
  views_30d: number
}

export async function loadPublishedArticles(
  options: LoadArticlesOptions = {}
): Promise<{ articles: ArticleListItem[]; error: string | null }> {
  const limit = options.limit ?? 50
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, content, published_at, cluster_id, image_url, category, genre')
    .eq('published', true)
    .order('published_at', { ascending: false })
    .limit(200)

  if (error) {
    return { articles: [], error: error.message }
  }

  const rows = ((data ?? []) as ArticleRow[])
    .filter((row) => !options.category || matchesCategory(row.category, options.category))
    .filter((row) => !options.genre || matchesGenre(row.genre, options.genre))
    .slice(0, limit)

  const imageByCluster = await loadImagesByCluster(rows)

  const articles: ArticleListItem[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    published_at: row.published_at,
    cluster_id: row.cluster_id,
    article_image_url: isUsableImageUrl(row.image_url) ? row.image_url : null,
    imageUrl: isUsableImageUrl(row.image_url)
      ? row.image_url
      : row.cluster_id
        ? imageByCluster.get(row.cluster_id) ?? null
        : null,
    category: row.category,
    genre: row.genre,
  }))

  return { articles, error: null }
}

export async function loadPopularArticles(
  latestArticles: ArticleListItem[],
  limit = 5
): Promise<ArticleListItem[]> {
  const fallback = latestArticles.slice(0, limit)
  const { data: viewData, error: viewError } = await supabase
    .from('article_views')
    .select('slug, views_30d')
    .order('views_30d', { ascending: false })
    .limit(limit)

  if (viewError) {
    console.warn('[Popular Articles] article_views 조회 실패, 최신 기사로 대체:', viewError.message)
    return fallback
  }

  const rankedViews = ((viewData ?? []) as ArticleViewRow[])
    .filter((row) => row.views_30d > 0)
  if (rankedViews.length === 0) return fallback

  const rankedSlugs = rankedViews.map((row) => row.slug)
  const { data: articleData, error: articleError } = await supabase
    .from('articles')
    .select('id, slug, title, content, published_at, cluster_id, image_url, category, genre')
    .eq('published', true)
    .in('slug', rankedSlugs)

  if (articleError) {
    console.warn('[Popular Articles] 발행 기사 매칭 실패, 최신 기사로 대체:', articleError.message)
    return fallback
  }

  const articleBySlug = new Map<string, ArticleRow>(
    ((articleData ?? []) as ArticleRow[])
      .filter((row): row is ArticleRow & { slug: string } => Boolean(row.slug))
      .map((row) => [row.slug, row])
  )
  const rankedRows = rankedSlugs
    .map((slug) => articleBySlug.get(slug))
    .filter((row): row is ArticleRow => Boolean(row))
  const imageByCluster = await loadImagesByCluster(rankedRows)
  const popular: ArticleListItem[] = rankedRows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    content: row.content,
    published_at: row.published_at,
    cluster_id: row.cluster_id,
    article_image_url: isUsableImageUrl(row.image_url) ? row.image_url : null,
    imageUrl: isUsableImageUrl(row.image_url)
      ? row.image_url
      : row.cluster_id
        ? imageByCluster.get(row.cluster_id) ?? null
        : null,
    category: row.category,
    genre: row.genre,
  }))
  const usedIds = new Set(popular.map((article) => article.id))

  for (const article of latestArticles) {
    if (popular.length >= limit) break
    if (usedIds.has(article.id)) continue
    popular.push(article)
    usedIds.add(article.id)
  }

  return popular
}

export async function loadTaxonomyParams(): Promise<{
  categories: string[]
  genres: string[]
}> {
  const { data } = await supabase
    .from('articles')
    .select('category, genre')
    .eq('published', true)

  const categories = new Set<string>()
  const genres = new Set<string>()

  for (const row of (data ?? []) as Pick<ArticleRow, 'category' | 'genre'>[]) {
    const category = normalizeTaxonomySlug(row.category)
    const genre = normalizeTaxonomySlug(row.genre)
    if (category) categories.add(category)
    if (genre) genres.add(genre)
  }

  return {
    categories: Array.from(categories),
    genres: Array.from(genres),
  }
}

export async function loadClusterImageUrl(clusterId: string | null): Promise<string | null> {
  if (!clusterId) return null

  const { data: caData } = await supabase
    .from('cluster_articles')
    .select('raw_article_id')
    .eq('cluster_id', clusterId)

  const rawIds = ((caData ?? []) as { raw_article_id: string }[])
    .map((row) => row.raw_article_id)
    .filter(Boolean)
  if (rawIds.length === 0) return null

  const { data: rawData } = await supabase
    .from('raw_articles')
    .select('image_url')
    .in('id', rawIds)
    .not('image_url', 'is', null)

  return firstUsableImageUrl((rawData ?? []) as { image_url: string | null }[])
}

async function loadImagesByCluster(rows: ArticleRow[]): Promise<Map<string, string>> {
  const clusterIds = Array.from(
    new Set(rows.map((row) => row.cluster_id).filter((id): id is string => Boolean(id)))
  )
  const imageByCluster = new Map<string, string>()

  if (clusterIds.length === 0) return imageByCluster

  const { data: caData } = await supabase
    .from('cluster_articles')
    .select('cluster_id, raw_article_id')
    .in('cluster_id', clusterIds)

  const clusterArticles = (caData ?? []) as ClusterArticleRow[]
  const rawIds = Array.from(
    new Set(clusterArticles.map((ca) => ca.raw_article_id).filter(Boolean))
  )

  if (rawIds.length === 0) return imageByCluster

  const { data: rawData } = await supabase
    .from('raw_articles')
    .select('id, image_url')
    .in('id', rawIds)
    .not('image_url', 'is', null)

  const imageByRawId = new Map<string, string>()
  for (const row of (rawData ?? []) as RawArticleImageRow[]) {
    if (isUsableImageUrl(row.image_url)) imageByRawId.set(row.id, row.image_url)
  }

  for (const ca of clusterArticles) {
    if (imageByCluster.has(ca.cluster_id)) continue
    const img = imageByRawId.get(ca.raw_article_id)
    if (img) imageByCluster.set(ca.cluster_id, img)
  }

  return imageByCluster
}

function firstUsableImageUrl(rows: { image_url: string | null }[]): string | null {
  return rows.find((row) => isUsableImageUrl(row.image_url))?.image_url ?? null
}

export function isUsableImageUrl(url: string | null): url is string {
  if (!url) return false
  if (!/^https?:\/\//i.test(url)) return false

  const lower = url.toLowerCase()
  // static.ra.co often rejects hotlinked image requests with Cloudflare 403.
  if (lower.includes('static.ra.co/images/')) return false

  return true
}
