import { RawArticle, SuggestionWithArticles } from './types'
import { calculateCohesionScore } from './normalize'
import { canMergeByEventDate } from './event-date'

const MAX_MERGED_ARTICLES = 10
const MAX_KEYWORDS = 6
const MAX_COMMON_ENTITIES = 5
const KEYWORD_OVERLAP_THRESHOLD = 2
const ENTITY_OVERLAP_THRESHOLD = 1
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

type ArticleMeta = { id: string; title: string; url: string }

function toKey(value: string): string {
  return value.trim().toLowerCase()
}

function toKeySet(values: string[] | undefined): Set<string> {
  const set = new Set<string>()
  for (const v of values ?? []) {
    const key = toKey(v)
    if (key.length > 0) set.add(key)
  }
  return set
}

function countOverlap(a: Set<string>, b: Set<string>): number {
  let count = 0
  for (const value of a) {
    if (b.has(value)) count++
  }
  return count
}

function latestPublishedAt(
  articleIds: string[],
  articleById: Map<string, RawArticle>
): number | null {
  let latest: number | null = null
  for (const id of articleIds) {
    const raw = articleById.get(id)?.published_at
    if (!raw) continue
    const ts = Date.parse(raw)
    if (!Number.isFinite(ts)) continue
    if (latest === null || ts > latest) latest = ts
  }
  return latest
}

function pairMergeScore(
  a: SuggestionWithArticles,
  b: SuggestionWithArticles,
  articleById: Map<string, RawArticle>
): number | null {
  if (!canMergeByEventDate(a.articleIds, b.articleIds, articleById)) {
    return null
  }

  const entitiesA = toKeySet(a.commonEntities)
  const entitiesB = toKeySet(b.commonEntities)
  const entityOverlap = countOverlap(entitiesA, entitiesB)

  const keywordsA = toKeySet(a.keywords)
  const keywordsB = toKeySet(b.keywords)
  const keywordOverlap = countOverlap(keywordsA, keywordsB)

  let mergeable = false
  if (entityOverlap >= ENTITY_OVERLAP_THRESHOLD) {
    mergeable = true
  } else if (keywordOverlap >= KEYWORD_OVERLAP_THRESHOLD) {
    const latestA = latestPublishedAt(a.articleIds, articleById)
    const latestB = latestPublishedAt(b.articleIds, articleById)
    if (
      latestA !== null
      && latestB !== null
      && Math.abs(latestA - latestB) <= RECENCY_WINDOW_MS
    ) {
      mergeable = true
    }
  }

  if (!mergeable) return null
  return entityOverlap * 2 + keywordOverlap
}

function pickTopicSource(group: SuggestionWithArticles[]): SuggestionWithArticles {
  let best = group[0]
  for (let i = 1; i < group.length; i++) {
    if (group[i].articleIds.length > best.articleIds.length) {
      best = group[i]
    }
  }
  return best
}

function mergeStringsByKey(
  group: SuggestionWithArticles[],
  pick: (s: SuggestionWithArticles) => string[] | undefined,
  cap: number
): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const s of group) {
    for (const value of pick(s) ?? []) {
      const trimmed = value.trim()
      if (!trimmed) continue
      const key = trimmed.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      result.push(trimmed)
      if (result.length >= cap) return result
    }
  }
  return result
}

function mergeArticleIds(group: SuggestionWithArticles[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const s of group) {
    for (const id of s.articleIds) {
      if (seen.has(id)) continue
      seen.add(id)
      result.push(id)
    }
  }
  return result
}

function trimByCohesion(
  articleIds: string[],
  group: SuggestionWithArticles[]
): string[] {
  if (articleIds.length <= MAX_MERGED_ARTICLES) return articleIds

  const scoreByArticleId = new Map<string, number>()
  for (const s of group) {
    const score = s.cohesionScore ?? 0
    for (const id of s.articleIds) {
      const current = scoreByArticleId.get(id)
      if (current === undefined || score > current) {
        scoreByArticleId.set(id, score)
      }
    }
  }

  return [...articleIds]
    .sort((a, b) => (scoreByArticleId.get(b) ?? 0) - (scoreByArticleId.get(a) ?? 0))
    .slice(0, MAX_MERGED_ARTICLES)
}

function buildMergedSuggestion(
  group: SuggestionWithArticles[],
  articleMeta: Map<string, ArticleMeta>,
  rawArticles: RawArticle[]
): SuggestionWithArticles {
  if (group.length === 1) return group[0]

  const topicSource = pickTopicSource(group)
  const keywords = mergeStringsByKey(group, (s) => s.keywords, MAX_KEYWORDS)
  const commonEntities = mergeStringsByKey(group, (s) => s.commonEntities, MAX_COMMON_ENTITIES)
  const articleIds = trimByCohesion(mergeArticleIds(group), group)
  const cohesionScore = calculateCohesionScore(articleIds, commonEntities, rawArticles)
  const articles = articleIds
    .map((id) => articleMeta.get(id))
    .filter((a): a is ArticleMeta => a !== undefined)

  return {
    topic: topicSource.topic,
    keywords,
    articleIds,
    reason: topicSource.reason,
    commonEntities,
    cohesionScore,
    articles,
  }
}

type Pair = { i: number; j: number; score: number }

export function mergeNormalizedSuggestions(
  suggestions: SuggestionWithArticles[],
  rawArticles: RawArticle[]
): SuggestionWithArticles[] {
  if (suggestions.length <= 1) return suggestions

  const articleById = new Map(rawArticles.map((a) => [a.id, a]))

  const pairs: Pair[] = []
  for (let i = 0; i < suggestions.length; i++) {
    for (let j = i + 1; j < suggestions.length; j++) {
      const score = pairMergeScore(suggestions[i], suggestions[j], articleById)
      if (score !== null) {
        pairs.push({ i, j, score })
      }
    }
  }
  pairs.sort((a, b) => b.score - a.score)

  const articleMeta = new Map<string, ArticleMeta>()
  for (const s of suggestions) {
    for (const article of s.articles) {
      if (!articleMeta.has(article.id)) {
        articleMeta.set(article.id, article)
      }
    }
  }

  const used = new Set<number>()
  const merged: SuggestionWithArticles[] = []

  // Greedy pairwise: 점수 높은 쌍부터, 둘 다 미사용일 때만 병합 (전이성 없음)
  for (const { i, j } of pairs) {
    if (used.has(i) || used.has(j)) continue
    merged.push(
      buildMergedSuggestion([suggestions[i], suggestions[j]], articleMeta, rawArticles)
    )
    used.add(i)
    used.add(j)
  }

  // 병합에 참여하지 않은 나머지는 단독으로 유지
  for (let i = 0; i < suggestions.length; i++) {
    if (!used.has(i)) {
      merged.push(suggestions[i])
    }
  }

  console.log(`[merge] 병합 전: ${suggestions.length}건 → 병합 후: ${merged.length}건`)
  return merged
}
