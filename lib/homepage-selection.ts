import type { ArticleListItem } from '@/lib/articles'

export const HOMEPAGE_LATEST_FETCH_LIMIT = 23
export const HOMEPAGE_POPULAR_INPUT_LIMIT = 20
export const HOMEPAGE_LATEST_LIMIT = 19

export const HOMEPAGE_PLACEMENTS = [
  'homepage_hero',
  'homepage_featured_1',
  'homepage_featured_2',
  'homepage_featured_3',
] as const

export type HomepagePlacement = (typeof HOMEPAGE_PLACEMENTS)[number]
export type HomepageFeaturedPlacement = Exclude<HomepagePlacement, 'homepage_hero'>

export type ManualHomepagePlacement = {
  placement: HomepagePlacement
  articleId: string | null
  updatedAt: string | null
}

export type FeatureCandidate = {
  article: ArticleListItem
  featuredAt: string
}

export type HomepageSelection = {
  hero: ArticleListItem | null
  heroSource: 'manual' | 'latest' | null
  featured: Array<{
    placement: HomepageFeaturedPlacement
    article: ArticleListItem
    source: 'manual' | 'automatic'
  }>
  latest: ArticleListItem[]
}

export function isHomepagePlacement(value: unknown): value is HomepagePlacement {
  return typeof value === 'string' && HOMEPAGE_PLACEMENTS.includes(value as HomepagePlacement)
}

export function selectHomepageContent(input: {
  latestArticles: ArticleListItem[]
  manualPlacements: ManualHomepagePlacement[]
  placementArticles: Map<string, ArticleListItem>
  featureCandidates: FeatureCandidate[]
  featureArticleIds: Set<string>
}): HomepageSelection {
  const placementByName = new Map(input.manualPlacements.map((row) => [row.placement, row]))
  const selectedIds = new Set<string>()

  const validManualArticle = (placement: HomepagePlacement): ArticleListItem | null => {
    const articleId = placementByName.get(placement)?.articleId
    if (!articleId || selectedIds.has(articleId) || !input.featureArticleIds.has(articleId)) return null
    return input.placementArticles.get(articleId) ?? null
  }

  const manualHero = validManualArticle('homepage_hero')
  const hero = manualHero ?? input.latestArticles[0] ?? null
  const heroSource = manualHero ? 'manual' : hero ? 'latest' : null
  if (hero) selectedIds.add(hero.id)

  const featured: HomepageSelection['featured'] = []
  const emptySlots: HomepageFeaturedPlacement[] = []
  for (const placement of HOMEPAGE_PLACEMENTS.slice(1) as HomepageFeaturedPlacement[]) {
    const article = validManualArticle(placement)
    if (article) {
      featured.push({ placement, article, source: 'manual' })
      selectedIds.add(article.id)
    } else {
      emptySlots.push(placement)
    }
  }

  let candidateIndex = 0
  for (const placement of emptySlots) {
    while (
      candidateIndex < input.featureCandidates.length &&
      selectedIds.has(input.featureCandidates[candidateIndex].article.id)
    ) candidateIndex += 1

    const candidate = input.featureCandidates[candidateIndex]
    if (!candidate) break
    featured.push({ placement, article: candidate.article, source: 'automatic' })
    selectedIds.add(candidate.article.id)
    candidateIndex += 1
  }

  featured.sort((a, b) => HOMEPAGE_PLACEMENTS.indexOf(a.placement) - HOMEPAGE_PLACEMENTS.indexOf(b.placement))

  return {
    hero,
    heroSource,
    featured,
    latest: input.latestArticles
      .filter((article) => !selectedIds.has(article.id))
      .slice(0, HOMEPAGE_LATEST_LIMIT),
  }
}
