import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { HOMEPAGE_HERO_PLACEMENT } from '@/lib/homepage-placement'
import type {
  HeroMutationResult,
  HeroMutationStatus,
} from '@/lib/homepage-hero-mutation'

export type AdminHomepageHeroState = {
  articleId: string
  updatedAt: string
  effective: boolean
  article: {
    id: string
    title: string
    slug: string | null
    published: boolean
    publishedAt: string | null
  } | null
} | null

type PlacementRow = {
  article_id: string | null
  updated_at: string
}

type AdminArticleRow = {
  id: string
  title: string
  slug: string | null
  published: boolean
  published_at: string | null
}

type MutationRow = {
  result: HeroMutationStatus
  article_id: string | null
  changed: boolean
  updated_at: string | null
}

export async function loadAdminHomepageHero(): Promise<AdminHomepageHeroState> {
  const { data, error } = await supabase
    .from('homepage_placements')
    .select('article_id, updated_at')
    .eq('placement', HOMEPAGE_HERO_PLACEMENT)
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error('homepage_hero placement row is missing')

  const placement = data as PlacementRow
  if (!placement.article_id) return null

  const { data: articleData, error: articleError } = await supabase
    .from('articles')
    .select('id, title, slug, published, published_at')
    .eq('id', placement.article_id)
    .maybeSingle()

  if (articleError) throw new Error(articleError.message)
  const article = articleData as AdminArticleRow | null

  return {
    articleId: placement.article_id,
    updatedAt: placement.updated_at,
    effective: article?.published === true,
    article: article
      ? {
          id: article.id,
          title: article.title,
          slug: article.slug,
          published: article.published,
          publishedAt: article.published_at,
        }
      : null,
  }
}

export async function setAdminHomepageHero(
  articleId: string | null
): Promise<HeroMutationResult> {
  const { data, error } = await supabase.rpc('set_homepage_hero', {
    requested_article_id: articleId,
  })

  if (error) throw new Error(error.message)
  const row = ((data ?? []) as MutationRow[])[0]
  if (!row) throw new Error('set_homepage_hero returned no result')

  return {
    result: row.result,
    articleId: row.article_id,
    changed: row.changed,
    updatedAt: row.updated_at,
  }
}

