import { EntityEntry, RawArticle, SuggestionWithArticles } from './types'

function scoreSuggestion(
  s: SuggestionWithArticles,
  rawArticles: RawArticle[],
  dict: EntityEntry[]
): number {
  const articleMap = new Map(rawArticles.map((a) => [a.id, a]))

  const cohesion = s.cohesionScore ?? 0

  const dictMap = new Map(
    dict
      .filter((entity) => entity.role !== 'supporting')
      .map((entity) => [entity.canonical.toLowerCase(), entity.weight])
  )
  const maxEntityWeight = s.commonEntities && s.commonEntities.length > 0
    ? Math.max(...s.commonEntities.map((e) => dictMap.get(e.toLowerCase()) ?? 0))
    : 0

  const articleBonus = Math.min(s.articleIds.length, 4)

  const sourceIds = new Set(
    s.articleIds
      .map((id) => articleMap.get(id)?.source_id)
      .filter((sid): sid is string | number => sid !== null && sid !== undefined)
  )
  const uniqueSourceCount = sourceIds.size

  const now = Date.now()
  const freshnessBonus = s.articleIds.some((id) => {
    const pub = articleMap.get(id)?.published_at
    if (!pub) return false
    return now - new Date(pub).getTime() <= 48 * 60 * 60 * 1000
  }) ? 1 : 0

  return (
    cohesion * 1.0
    + maxEntityWeight * 15
    + articleBonus * 5
    + uniqueSourceCount * 10
    + freshnessBonus * 5
  )
}

export function rankAndTrim(
  suggestions: SuggestionWithArticles[],
  rawArticles: RawArticle[],
  dict: EntityEntry[],
  topN: number = 30
): SuggestionWithArticles[] {
  const scored = suggestions.map((s) => ({
    suggestion: s,
    score: scoreSuggestion(s, rawArticles, dict),
  }))

  scored.sort((a, b) => b.score - a.score)

  const result = scored.slice(0, topN).map((entry) => entry.suggestion)

  console.log(`[rank] 랭킹 전: ${suggestions.length}건 → 상위 ${result.length}건 선별`)

  return result
}
