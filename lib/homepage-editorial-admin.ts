import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { HOMEPAGE_PLACEMENTS, type HomepagePlacement } from '@/lib/homepage-selection'
import type { EditorialMutationResult, EditorialMutationStatus } from '@/lib/homepage-editorial-mutation'

type ArticleSummary = { id: string; title: string; slug: string | null; published: boolean; published_at: string | null }
type PlacementRow = { placement: HomepagePlacement; article_id: string | null; updated_at: string }
type FeatureRow = { article_id: string; featured_at: string }
type AdminPlacementState = {
  placement: HomepagePlacement
  manualArticle: ArticleSummary | null
  effectiveArticle: ArticleSummary | null
  source: 'manual' | 'automatic' | 'latest'
  updatedAt: string | null
}
type MutationRow = {
  result: EditorialMutationStatus
  article_id: string | null
  placement?: HomepagePlacement | null
  changed: boolean
  updated_at?: string | null
  featured_at?: string | null
  cleared_placements?: HomepagePlacement[]
}

export async function loadAdminHomepageEditorialState() {
  const [{ data: placementData, error: placementError }, { data: featureData, error: featureError }] = await Promise.all([
    supabase.from('homepage_placements').select('placement, article_id, updated_at').order('placement'),
    supabase.from('article_features').select('article_id, featured_at').order('featured_at', { ascending: false }).order('article_id', { ascending: true }),
  ])
  if (placementError) throw new Error(placementError.message)
  if (featureError) throw new Error(featureError.message)
  const placements = (placementData ?? []) as PlacementRow[]
  const features = (featureData ?? []) as FeatureRow[]
  const ids = Array.from(new Set([...placements.flatMap((row) => row.article_id ? [row.article_id] : []), ...features.map((row) => row.article_id)]))
  const { data: articleData, error: articleError } = ids.length
    ? await supabase.from('articles').select('id, title, slug, published, published_at').in('id', ids)
    : { data: [], error: null }
  if (articleError) throw new Error(articleError.message)
  const articles = (articleData ?? []) as ArticleSummary[]
  const articleById = new Map(articles.map((article) => [article.id, article]))
  const featureById = new Map(features.map((feature) => [feature.article_id, feature]))
  const used = new Set<string>()
  const placementByName = new Map(placements.map((row) => [row.placement, row]))

  const effective: AdminPlacementState[] = HOMEPAGE_PLACEMENTS.map((placement): AdminPlacementState => {
    const row = placementByName.get(placement)
    const manualArticle = row?.article_id ? articleById.get(row.article_id) ?? null : null
    if (manualArticle?.published && featureById.has(manualArticle.id) && !used.has(manualArticle.id)) {
      used.add(manualArticle.id)
      return { placement, manualArticle, effectiveArticle: manualArticle, source: 'manual' as const, updatedAt: row?.updated_at ?? null }
    }
    return { placement, manualArticle, effectiveArticle: null, source: placement === 'homepage_hero' ? 'latest' as const : 'automatic' as const, updatedAt: row?.updated_at ?? null }
  })

  for (const item of effective) {
    if (item.placement === 'homepage_hero' || item.source === 'manual') continue
    const automatic = features
      .map((feature) => articleById.get(feature.article_id))
      .find((article) => article?.published && !used.has(article.id)) ?? null
    item.effectiveArticle = automatic
    if (automatic) used.add(automatic.id)
  }

  return {
    placements: effective,
    features: features.flatMap((feature) => {
      const article = articleById.get(feature.article_id)
      return article ? [{ articleId: feature.article_id, featuredAt: feature.featured_at, article }] : []
    }),
  }
}

export async function setAdminArticleFeature(articleId: string, placement: HomepagePlacement | null): Promise<EditorialMutationResult> {
  const { data, error } = await supabase.rpc('set_article_feature', { requested_article_id: articleId, requested_placement: placement })
  if (error) throw new Error(error.message)
  return mutationResult(data)
}

export async function removeAdminArticleFeature(articleId: string): Promise<EditorialMutationResult> {
  const { data, error } = await supabase.rpc('remove_article_feature', { requested_article_id: articleId })
  if (error) throw new Error(error.message)
  return mutationResult(data)
}

export async function setAdminHomepagePlacement(placement: HomepagePlacement, articleId: string): Promise<EditorialMutationResult> {
  const { data, error } = await supabase.rpc('set_homepage_placement', { requested_placement: placement, requested_article_id: articleId })
  if (error) throw new Error(error.message)
  return mutationResult(data)
}

export async function clearAdminHomepagePlacement(placement: HomepagePlacement): Promise<EditorialMutationResult> {
  const { data, error } = await supabase.rpc('clear_homepage_placement', { requested_placement: placement })
  if (error) throw new Error(error.message)
  return mutationResult(data)
}

function mutationResult(data: unknown): EditorialMutationResult {
  const row = ((data ?? []) as MutationRow[])[0]
  if (!row) throw new Error('homepage editorial mutation returned no result')
  return {
    result: row.result, articleId: row.article_id, placement: row.placement,
    changed: row.changed, updatedAt: row.updated_at, featuredAt: row.featured_at,
    clearedPlacements: row.cleared_placements,
  }
}
