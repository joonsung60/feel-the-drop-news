import { MIN_COHESION_SCORE, RawArticle, SuggestionWithArticles } from './types'
import {
  articleSnippet,
  calculateCohesionScore,
  isSourceOrSeriesEntity,
} from './normalize'
import { canMergeByEventDate } from './event-date'

const MAX_MERGED_ARTICLES = 10
const MAX_KEYWORDS = 6
const MAX_COMMON_ENTITIES = 5
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const GENERIC_STORY_TERMS = new Set([
  'announce', 'announced', 'announcement', 'artist', 'artists', 'event', 'festival',
  'lineup', 'music',
  'new', 'official', 'release', 'released', 'releases', 'single', 'album', 'ep',
  'track', 'tour', 'show', 'performance', 'video', 'interview', 'premiere',
  'set', 'sets', 'stage', 'stages',
  '공개', '발표', '발매', '릴리즈', '신곡', '싱글', '앨범', '행사', '페스티벌',
  '라인업', '공연', '영상', '인터뷰', '공식', '관련', '소식', '투어',
])

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

function normalizeStoryTerm(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(?:deaths?|died|fatalities|todesfällen|todesfaellen)\b|사망/g, ' fatality ')
    .replace(
      /\b(?:ends?\s+early|ended\s+early|early\s+termination|abruptly\s+cancelled|vorzeitig\s+beendet)\b|조기\s*종료/g,
      ' early termination ',
    )
    .replace(/[’‘“”"'`]/g, ' ')
    .replace(/[^a-z0-9가-힣]+/g, ' ')
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !GENERIC_STORY_TERMS.has(token))
    .join(' ')
    .trim()
}

function quotedTopicTerms(topic: string): string[] {
  return [...topic.matchAll(/[‘’“”"'`]([^‘’“”"'`]+)[‘’“”"'`]/g)]
    .map((match) => match[1])
}

function discriminativeTerms(suggestion: SuggestionWithArticles): Set<string> {
  const entityKeys = toKeySet(suggestion.commonEntities)
  const terms = new Set<string>()
  for (const value of [...suggestion.keywords, ...quotedTopicTerms(suggestion.topic)]) {
    const normalized = normalizeStoryTerm(value)
    if (
      normalized.length >= 3
      && !entityKeys.has(normalized)
      && !GENERIC_STORY_TERMS.has(normalized)
    ) {
      terms.add(normalized)
      for (const token of normalized.split(' ')) {
        if (token.length >= 5 && !GENERIC_STORY_TERMS.has(token)) {
          terms.add(token)
        }
      }
    }
  }
  return terms
}

function groundedTerms(
  suggestion: SuggestionWithArticles,
  articleById: Map<string, RawArticle>,
): Set<string> {
  const terms = discriminativeTerms(suggestion)
  const articles = suggestion.articleIds
    .map((id) => articleById.get(id))
    .filter((article): article is RawArticle => article !== undefined)
  if (articles.length !== suggestion.articleIds.length) return new Set()

  return new Set([...terms].filter((term) => {
    if (isSourceOrSeriesEntity(term)) return false
    const tokens = term.split(' ').filter(Boolean)
    return articles.every((article) => {
      const source = normalizeStoryTerm(article.sourceName ?? '')
      if (source && (term === source || source.includes(term))) return false
      const text = normalizeStoryTerm(`${article.title} ${articleSnippet(article)}`)
      return text.includes(term) || tokens.every((token) => text.includes(token))
    })
  }))
}

function storyOverlap(
  a: SuggestionWithArticles,
  b: SuggestionWithArticles,
  articleById: Map<string, RawArticle>,
): number {
  const termsA = groundedTerms(a, articleById)
  const termsB = groundedTerms(b, articleById)
  let score = 0
  for (const left of termsA) {
    for (const right of termsB) {
      if (left === right) {
        score = Math.max(score, left.includes(' ') ? 2 : 1)
      } else if (
        Math.min(left.length, right.length) >= 5
        && (left.includes(right) || right.includes(left))
      ) {
        score = Math.max(score, 1)
      }
    }
  }
  return score
}

function sharedStoryTerms(
  group: SuggestionWithArticles[],
  articleById: Map<string, RawArticle>,
): string[] {
  if (group.length < 2) return []
  const first = groundedTerms(group[0], articleById)
  const rest = group.slice(1).map((suggestion) => groundedTerms(suggestion, articleById))
  return [...first].filter((left) => rest.every((terms) =>
    [...terms].some((right) =>
      left === right
      || (
        Math.min(left.length, right.length) >= 5
        && (left.includes(right) || right.includes(left))
      )
    )
  ))
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

  const discriminativeOverlap = storyOverlap(a, b, articleById)
  let mergeable = entityOverlap >= 1 && discriminativeOverlap >= 1
  if (entityOverlap === 0 && discriminativeOverlap >= 2) {
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
  return entityOverlap * 2 + discriminativeOverlap
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

function intersectStringsByKey(
  group: SuggestionWithArticles[],
  pick: (s: SuggestionWithArticles) => string[] | undefined,
  cap: number
): string[] {
  const first = pick(group[0]) ?? []
  const remaining = group.slice(1).map((suggestion) =>
    new Set((pick(suggestion) ?? []).map(toKey))
  )
  return first
    .filter((value) => remaining.every((values) => values.has(toKey(value))))
    .slice(0, cap)
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
  const commonEntities = intersectStringsByKey(
    group,
    (s) => s.commonEntities,
    MAX_COMMON_ENTITIES,
  )
  const articleIds = trimByCohesion(mergeArticleIds(group), group)
  const entityCohesion = calculateCohesionScore(articleIds, commonEntities, rawArticles)
  const commonStoryAnchors = sharedStoryTerms(
    group,
    new Map(rawArticles.map((article) => [article.id, article])),
  )
  const storyCohesion = commonStoryAnchors.length > 0
    ? Math.min(100, 80 + Math.min(articleIds.length, 5) * 4)
    : 0
  const cohesionScore = Math.max(entityCohesion, storyCohesion)
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

export function mergeNormalizedSuggestions(
  suggestions: SuggestionWithArticles[],
  rawArticles: RawArticle[]
): SuggestionWithArticles[] {
  if (suggestions.length <= 1) return suggestions

  const articleById = new Map(rawArticles.map((a) => [a.id, a]))

  const articleMeta = new Map<string, ArticleMeta>()
  for (const s of suggestions) {
    for (const article of s.articles) {
      if (!articleMeta.has(article.id)) {
        articleMeta.set(article.id, article)
      }
    }
  }

  const merged = [...suggestions]
  while (true) {
    const pairs: Array<{ i: number; j: number; score: number }> = []
    for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        const score = pairMergeScore(merged[i], merged[j], articleById)
        if (score !== null) pairs.push({ i, j, score })
      }
    }
    pairs.sort((a, b) => b.score - a.score)

    let accepted: { i: number; j: number; candidate: SuggestionWithArticles } | null = null
    for (const { i, j } of pairs) {
      const candidate = buildMergedSuggestion(
        [merged[i], merged[j]],
        articleMeta,
        rawArticles,
      )
      if (
        candidate.cohesionScore !== undefined
        && candidate.cohesionScore >= MIN_COHESION_SCORE
      ) {
        accepted = { i, j, candidate }
        break
      }
    }
    if (!accepted) break

    const next = merged.filter((_, index) => index !== accepted!.i && index !== accepted!.j)
    next.push(accepted.candidate)
    merged.splice(0, merged.length, ...next)
  }

  console.log(`[merge] 병합 전: ${suggestions.length}건 → 병합 후: ${merged.length}건`)
  return merged
}
