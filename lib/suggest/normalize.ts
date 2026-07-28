import { cleanArticleText } from '@/lib/article-extraction'
import { MIN_COHESION_SCORE, RawArticle, Suggestion, SuggestionWithArticles } from './types'
import { hasEventDateConflict } from './event-date'
import { hasExplicitEdmEvidence } from './eligibility'

export const CATEGORY_KEYWORDS = new Set([
  'album', 'albums', 'club', 'clubs', 'dj', 'edm', 'festival', 'festivals', 'house',
  'intros', 'lineup', 'line-ups', 'music', 'new', 'new music', 'premiere', 'preview',
  'record', 'records', 'release', 'released', 'releases', 'single', 'synth', 'synths',
  'techno', 'track', 'tracks',
])

export const STOPWORDS = new Set([
  'about', 'after', 'album', 'albums', 'also', 'and', 'are', 'artist', 'artists', 'back',
  'best', 'can', 'club', 'dance', 'deep', 'dj', 'edm', 'from', 'has', 'have', 'home',
  'house', 'into', 'label', 'live', 'magazine', 'menu', 'mix', 'music', 'new', 'news',
  'out', 'premiere', 'preview', 'records', 'release', 'released', 'releases', 'review',
  'show', 'site', 'single', 'so', 'techno', 'tech', 'the', 'this', 'track', 'tracks',
  'with', 'year', 'far', 'just', 'page', 'privacy', 'policy', 'cookie', 'cookies',
  'http', 'https', 'www', 'com', 'net', 'org',
])

export const SOURCE_OR_SERIES_PATTERNS = [
  /\b909originals\b/i,
  /^ia mix(?:\s+\d+)?$/i,
  /^myrecordbag$/i,
  /\b(bandcamp daily|beatportal|attack magazine|inverted audio)\b/i,
  /\b(mixmag|dj mag|the quietus|crack magazine|ransom note|5 magazine)\b/i,
  /\b(create digital music|cdm|groove magazine|fazemag|tsugi)\b/i,
]

export const LOW_SIGNAL_CLUSTER_PATTERNS = [
  /^(?:19|20)\d{2}$/i,
  /^(?:19|20)\d{2}\s+(?:related|news|review|in review)$/i,
  /\b(?:catches up with|chats to|talks to|interview with|in conversation with)\b/i,
  /\b(?:best electronic music|best albums|best tracks|top-selling tracks|top selling tracks|chart toppers)\b/i,
  /\bfestival line-ups you might\b/i,
  /음악\s*산업(?:의)?\s*(?:변화|도전|동향)/i,
  /음악\s*페스티벌(?:과|와)\s*라이브\s*공연/i,
  /전자\s*음악\s*씬\s*(?:동향|변화|흐름)/i,
  /클럽\s*문화(?:의)?\s*(?:변화|동향|흐름)/i,
]

export function articleSnippet(article: RawArticle): string {
  return cleanArticleText(article.content ?? '', 500)
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseSuggestions(responseText: string): { suggestions?: Suggestion[] } {
  try {
    return JSON.parse(responseText)
  } catch {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('LLM 응답 JSON 파싱 실패')
    }
    return JSON.parse(jsonMatch[0])
  }
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function normalizeEntity(entity: string): string {
  return entity
    .replace(/^[-–—:|]\s*/i, '')
    .replace(/^(at|for|of|the|with)\s+/i, '')
    .replace(/\s+[-–—|]\s*(909originals|bandcamp daily|beatportal|attack magazine|inverted audio|mixmag|dj mag|cdm|create digital music)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isCategoryKeyword(keyword: string): boolean {
  return CATEGORY_KEYWORDS.has(normalizeText(keyword))
}

export function isUrlOrDomainText(text: string): boolean {
  const lower = text.toLowerCase()
  const normalized = normalizeText(text)
  return /\bhttps?:\/\//.test(lower)
    || /\bwww\./.test(lower)
    || /\b[a-z0-9-]+\.(com|net|org|co|uk|de|fr|io|fm)\b/.test(lower)
    || /\b(https|http|www)\b/.test(normalized)
    || /\b(com|net|org|co|uk|de|fr|io|fm)\b/.test(normalized)
}

export function isSourceOrSeriesEntity(text: string): boolean {
  const normalized = normalizeEntity(text)
  return SOURCE_OR_SERIES_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function isLowSignalClusterText(text: string): boolean {
  const normalized = normalizeText(text)
  return LOW_SIGNAL_CLUSTER_PATTERNS.some((pattern) => pattern.test(normalized))
}

export function isSpecificEntity(entity: string): boolean {
  const normalized = normalizeText(entity)
  if (
    !normalized
    || isCategoryKeyword(normalized)
    || isUrlOrDomainText(entity)
    || isSourceOrSeriesEntity(entity)
    || isLowSignalClusterText(entity)
  ) {
    return false
  }
  if (/\b(of the year|the year|so far|year \d{4})\b/.test(normalized) || /[&-]$/.test(entity.trim())) {
    return false
  }

  const tokens = normalized.split(' ').filter(Boolean)
  if (tokens.length >= 2) {
    return tokens.some((token) => !STOPWORDS.has(token) && !CATEGORY_KEYWORDS.has(token) && !/^\d+$/.test(token))
  }

  const originalTokens = entity.split(/\s+/).filter(Boolean)
  const hasUppercaseSignal = originalTokens.some((token) => /[A-Z]/.test(token[0]) || /^[A-Z0-9]{2,}$/.test(token))
  return hasUppercaseSignal && normalized.length >= 4 && !STOPWORDS.has(normalized)
}

export function calculateCohesionScore(articleIds: string[], commonEntities: string[], rawArticles: RawArticle[]): number {
  if (articleIds.length < 2 || commonEntities.length === 0) {
    return 0
  }

  const articleById = new Map(rawArticles.map((article) => [article.id, article]))
  const entityHits = commonEntities.reduce((total, entity) => {
    const normalizedEntity = normalizeText(entity)
    const hits = articleIds.filter((id) => {
      const article = articleById.get(id)
      if (!article) {
        return false
      }
      const searchableText = normalizeText(`${article.title} ${articleSnippet(article)}`)
      return searchableText.includes(normalizedEntity)
    }).length
    return total + hits / articleIds.length
  }, 0)
  const averageEntityCoverage = entityHits / commonEntities.length
  const sizeBonus = Math.min(articleIds.length, 5) * 4
  const categoryPenalty = commonEntities.every((entity) => isCategoryKeyword(entity)) ? 45 : 0

  return Math.max(0, Math.min(100, Math.round(averageEntityCoverage * 80 + sizeBonus - categoryPenalty)))
}

export function normalizeSuggestion(
  suggestion: Partial<Suggestion>,
  validIds: Set<string>,
  articleMeta: Map<string, { id: string; title: string; url: string }>,
  rawArticles: RawArticle[],
  qualifyingEntitiesByArticle?: Map<string, Set<string>>,
): SuggestionWithArticles | null {
  const requestedArticleIds = Array.from(new Set(
    (Array.isArray(suggestion.articleIds) ? suggestion.articleIds : [])
      .map((id) => String(id).trim())
      .filter(Boolean)
  ))
  if (requestedArticleIds.some((id) => !validIds.has(id))) {
    return null
  }
  const articleIds = Array.from(new Set(
    requestedArticleIds.filter((id) => validIds.has(id))
  ))
  const keywords = Array.from(new Set(
    (Array.isArray(suggestion.keywords) ? suggestion.keywords : [])
      .map((keyword) => String(keyword).trim())
      .filter((keyword) => keyword.length > 0)
      .filter((keyword) => !isCategoryKeyword(keyword))
      .filter((keyword) => !isUrlOrDomainText(keyword))
      .filter((keyword) => !isSourceOrSeriesEntity(keyword))
      .filter((keyword) => !isLowSignalClusterText(keyword))
      .slice(0, 6)
  ))
  let commonEntities = Array.from(new Set(
    (Array.isArray(suggestion.commonEntities) ? suggestion.commonEntities : [])
      .map((entity) => normalizeEntity(String(entity)))
      .filter(isSpecificEntity)
      .slice(0, 5)
  ))
  if (qualifyingEntitiesByArticle) {
    commonEntities = commonEntities.filter((entity) =>
      articleIds.every((id) => {
        const deterministic = qualifyingEntitiesByArticle.get(id) ?? new Set()
        return [...deterministic].some((canonical) =>
          canonical.toLowerCase() === entity.toLowerCase()
        )
      })
    )
  }
  const topic = String(suggestion.topic ?? '').trim()
  const reason = String(suggestion.reason ?? '').trim()
  const cohesionScore = typeof suggestion.cohesionScore === 'number'
    ? Math.round(suggestion.cohesionScore)
    : articleIds.length === 1
      ? 0
      : calculateCohesionScore(
        articleIds,
        commonEntities.length > 0 ? commonEntities : keywords,
        rawArticles
      )

  const rawArticleById = new Map(rawArticles.map((article) => [article.id, article]))
  const singletonArticle = articleIds.length === 1 ? rawArticleById.get(articleIds[0]) : undefined
  const singletonEligible = articleIds.length > 1 || (
    Boolean(singletonArticle)
    && (
      qualifyingEntitiesByArticle
        ? (qualifyingEntitiesByArticle.get(articleIds[0])?.size ?? 0) > 0
          || hasExplicitEdmEvidence(singletonArticle!)
        : hasExplicitEdmEvidence(singletonArticle!)
    )
  )

  if (
    !topic
    || isUrlOrDomainText(topic)
    || isSourceOrSeriesEntity(topic)
    || isLowSignalClusterText(topic)
    || articleIds.length < 1
    || hasEventDateConflict(articleIds, rawArticles)
    || (articleIds.length > 1 && cohesionScore < MIN_COHESION_SCORE)
    || !singletonEligible
  ) {
    return null
  }

  if (keywords.length === 0 && commonEntities.length === 0) {
    return null
  }

  return {
    topic,
    keywords,
    articleIds,
    reason,
    commonEntities,
    cohesionScore,
    articles: articleIds.map((id) => articleMeta.get(id)!).filter(Boolean),
  }
}

export function normalizeTopicKey(topic: string): string {
  return topic.trim().toLowerCase()
}

export function chunkArticles(articles: RawArticle[], size: number): RawArticle[][] {
  const chunks: RawArticle[][] = []
  for (let i = 0; i < articles.length; i += size) {
    chunks.push(articles.slice(i, i + size))
  }
  return chunks
}
