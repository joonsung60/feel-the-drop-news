export type Suggestion = {
  topic: string
  keywords: string[]
  articleIds: string[]
  reason?: string
  commonEntities?: string[]
  cohesionScore?: number
}

export type SuggestionWithArticles = Suggestion & {
  articles: { id: string; title: string; url: string }[]
}

export type RawArticle = {
  id: string
  title: string
  content: string | null
  url: string
  source_id: string | number | null
  sourceName?: string
  published_at?: string | null
  event_date?: string | null
  facts?: {
    correspondent_gate?: {
      decision?: string
      path?: string
      candidate_key?: string
    }
    [key: string]: unknown
  } | null
}

export type SuggestionStatus = 'pending' | 'approved' | 'rejected' | 'published'

export const ALLOWED_STATUSES: SuggestionStatus[] = ['pending', 'approved', 'rejected', 'published']
export const MIN_COHESION_SCORE = 20
export const DEFAULT_ANALYSIS_LIMIT = 100
export const MAX_ANALYSIS_LIMIT = 100

export type DbSuggestedCluster = {
  id: string
  topic: string
  keywords: string[] | null
  article_ids: string[] | null
  status: SuggestionStatus
  cluster_id: string | null
  created_at: string
}

export type PersistedSuggestion = SuggestionWithArticles & {
  id: string
  status: SuggestionStatus
  clusterId: string | null
  articleId: string | null
  createdAt: string
}

export type TopicBlockRule = {
  id: string
  pattern: string
  reason: string | null
}

export type EntityEntry = {
  canonical: string
  role?: 'qualifying' | 'supporting'
  surfaces: string[]
  contextualSurfaces?: Array<{
    surface: string
    beforeContexts: string[]
    afterContexts: string[]
    maxGapChars: number
  }>
  weight: number
}

export type EntityDataset = {
  artists_top500_relevance_2024_2025?: Array<{ name?: string; aliases?: string[]; rank?: number; weight?: number }>
  major_edm_festivals_worldwide?: Array<{ name?: string }>
  edm_labels_key_artists?: Array<{ name?: string }>
  club_venues?: Array<{ name?: string; aliases?: string[] }>
  equipment_software_brands?: Array<{ name?: string; aliases?: string[] }>
}
