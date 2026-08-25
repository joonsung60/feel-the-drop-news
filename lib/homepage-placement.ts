import { supabase } from '@/lib/supabase'

export const HOMEPAGE_HERO_PLACEMENT = 'homepage_hero'

export type HomepageHeroPlacementResult = {
  articleId: string | null
  updatedAt: string | null
  error: string | null
  missing: boolean
}

type PlacementRow = {
  article_id: string | null
  updated_at: string
}

export async function loadHomepageHeroPlacement(): Promise<HomepageHeroPlacementResult> {
  const { data, error } = await supabase
    .from('homepage_placements')
    .select('article_id, updated_at')
    .eq('placement', HOMEPAGE_HERO_PLACEMENT)
    .maybeSingle()

  if (error) {
    return { articleId: null, updatedAt: null, error: error.message, missing: false }
  }

  if (!data) {
    return {
      articleId: null,
      updatedAt: null,
      error: 'homepage_hero placement row is missing',
      missing: true,
    }
  }

  const row = data as PlacementRow
  return {
    articleId: row.article_id,
    updatedAt: row.updated_at,
    error: null,
    missing: false,
  }
}

