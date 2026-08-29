import type { ArticleListItem } from '@/lib/articles'

export const HOMEPAGE_LATEST_LIMIT = 20
export const HOMEPAGE_GRID_LIMIT = 19

export type HomepageHeroSelection = {
  hero: ArticleListItem | null
  latest: ArticleListItem[]
}

export function selectHomepageHero(
  latestArticles: ArticleListItem[],
  pinnedArticle: ArticleListItem | null
): HomepageHeroSelection {
  const hero = pinnedArticle ?? latestArticles[0] ?? null
  if (!hero) return { hero: null, latest: [] }

  return {
    hero,
    latest: latestArticles
      .filter((article) => article.id !== hero.id)
      .slice(0, HOMEPAGE_GRID_LIMIT),
  }
}
