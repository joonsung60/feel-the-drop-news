import { supabase } from '@/lib/supabase'
import {
  HOMEPAGE_PLACEMENTS,
  type ManualHomepagePlacement,
} from '@/lib/homepage-selection'

export const HOMEPAGE_HERO_PLACEMENT = 'homepage_hero'

export type HomepageHeroPlacementResult = {
  articleId: string | null
  updatedAt: string | null
  error: string | null
  missing: boolean
}

type PlacementRow = {
  placement?: string
  article_id: string | null
  updated_at: string
}

export async function loadHomepagePlacements(): Promise<{
  placements: ManualHomepagePlacement[]
  error: string | null
  missing: string[]
}> {
  const { data, error } = await supabase
    .from('homepage_placements')
    .select('placement, article_id, updated_at')
    .in('placement', [...HOMEPAGE_PLACEMENTS])
  if (error) return { placements: [], error: error.message, missing: [...HOMEPAGE_PLACEMENTS] }

  const rows = (data ?? []) as Required<PlacementRow>[]
  const rowByPlacement = new Map(rows.map((row) => [row.placement, row]))
  const missing = HOMEPAGE_PLACEMENTS.filter((placement) => !rowByPlacement.has(placement))
  return {
    placements: HOMEPAGE_PLACEMENTS.flatMap((placement) => {
      const row = rowByPlacement.get(placement)
      return row ? [{ placement, articleId: row.article_id, updatedAt: row.updated_at }] : []
    }),
    error: null,
    missing,
  }
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
