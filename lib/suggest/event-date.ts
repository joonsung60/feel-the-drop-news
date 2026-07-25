import { RawArticle } from './types'

type ArticleDateLookup = Map<string, RawArticle> | RawArticle[]

function toArticleMap(articles: ArticleDateLookup): Map<string, RawArticle> {
  return articles instanceof Map
    ? articles
    : new Map(articles.map((article) => [article.id, article]))
}

export function knownEventDates(
  articleIds: string[],
  articles: ArticleDateLookup,
): string[] {
  const articleById = toArticleMap(articles)
  return Array.from(new Set(
    articleIds
      .map((id) => articleById.get(id)?.event_date)
      .filter((date): date is string => typeof date === 'string' && date.length > 0)
  )).sort()
}

export function hasEventDateConflict(
  articleIds: string[],
  articles: ArticleDateLookup,
): boolean {
  return knownEventDates(articleIds, articles).length > 1
}

export function canMergeByEventDate(
  leftIds: string[],
  rightIds: string[],
  articles: ArticleDateLookup,
): boolean {
  return !hasEventDateConflict([...leftIds, ...rightIds], articles)
}
