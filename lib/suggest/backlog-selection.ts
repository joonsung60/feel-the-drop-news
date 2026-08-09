import type { RawArticle } from './types'

export const INITIAL_SUGGEST2_CORRESPONDENT_FRESHNESS_HOURS = 72

export type Suggest2Group = {
  entity: string
  articleIds: string[]
  weightSum: number
}

const DAY_MS = 86_400_000

function originKey(article: RawArticle): string {
  return article.origin === 'rss' || article.origin === 'correspondent'
    ? article.origin
    : 'legacy'
}

function sourceKey(article: RawArticle): string {
  if (article.origin === 'rss' && article.source_id !== null) {
    return `rss:${String(article.source_id)}`
  }
  return article.ingestion_source ?? `${originKey(article)}:unknown`
}

function ageBucket(article: RawArticle, now: Date): string {
  const timestamp = Date.parse(article.published_at ?? article.fetched_at ?? '')
  const days = Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : (now.getTime() - timestamp) / DAY_MS
  if (days <= 7) return '0-7d'
  if (days <= 30) return '8-30d'
  if (days <= 90) return '31-90d'
  return '91d+'
}

export function selectSuggest2EntityArticles(
  articles: RawArticle[],
  limit: number,
  now = new Date(),
): RawArticle[] {
  const order = (subset: RawArticle[]) => {
    const queues = new Map<string, Suggest2Group[]>()
    const byId = new Map(subset.map((article) => [article.id, article]))
    for (const article of subset) {
      const key = `${originKey(article)}:${sourceKey(article)}:${ageBucket(article, now)}`
      const queue = queues.get(key) ?? []
      queue.push({ entity: '', articleIds: [article.id], weightSum: 0 })
      queue.sort((a, b) => {
        const articleA = byId.get(a.articleIds[0])!
        const articleB = byId.get(b.articleIds[0])!
        const checkedA = articleA.suggest2_last_checked_at ?? ''
        const checkedB = articleB.suggest2_last_checked_at ?? ''
        return checkedA.localeCompare(checkedB) || articleA.id.localeCompare(articleB.id)
      })
      queues.set(key, queue)
    }
    return roundRobin(queues)
      .map((group) => byId.get(group.articleIds[0]))
      .filter((article): article is RawArticle => Boolean(article))
  }
  return [
    ...order(articles.filter((article) => !article.suggest2_last_checked_at)),
    ...order(articles.filter((article) => Boolean(article.suggest2_last_checked_at))),
  ].slice(0, limit)
}

// Conservative LRU cursor: a group is considered as recent as its most recently
// checked article, so a partially newer group is not immediately selected again.
export function suggest2GroupLastCheckedAt(
  group: Suggest2Group,
  byId: Map<string, RawArticle>,
): string | null {
  const timestamps = group.articleIds.map((id) => byId.get(id)?.suggest2_last_checked_at ?? null)
  if (timestamps.some((timestamp) => timestamp === null)) return null
  return timestamps.reduce<string>((latest, timestamp) =>
    timestamp! > latest ? timestamp! : latest,
  '',) || null
}

function groupMetadata(group: Suggest2Group, byId: Map<string, RawArticle>, now: Date) {
  const articles = group.articleIds
    .map((id) => byId.get(id))
    .filter((article): article is RawArticle => Boolean(article))
  const anchor = [...articles].sort((a, b) =>
    `${originKey(a)}:${sourceKey(a)}:${a.id}`.localeCompare(
      `${originKey(b)}:${sourceKey(b)}:${b.id}`,
    )
  )[0]
  return {
    lastCheckedAt: suggest2GroupLastCheckedAt(group, byId),
    origin: anchor ? originKey(anchor) : 'legacy',
    source: anchor ? sourceKey(anchor) : 'legacy:unknown',
    age: anchor ? ageBucket(anchor, now) : '91d+',
  }
}

function roundRobin(queues: Map<string, Suggest2Group[]>): Suggest2Group[] {
  const result: Suggest2Group[] = []
  const keys = [...queues.keys()].sort()
  while (keys.some((key) => (queues.get(key)?.length ?? 0) > 0)) {
    for (const key of keys) {
      const next = queues.get(key)?.shift()
      if (next) result.push(next)
    }
  }
  return result
}

export function orderSuggest2Groups(
  groups: Suggest2Group[],
  articles: RawArticle[],
  now = new Date(),
): Suggest2Group[] {
  const byId = new Map(articles.map((article) => [article.id, article]))
  const order = (subset: Suggest2Group[]) => {
    const queues = new Map<string, Suggest2Group[]>()
    for (const group of subset) {
      const meta = groupMetadata(group, byId, now)
      const key = `${meta.origin}:${meta.source}:${meta.age}`
      const queue = queues.get(key) ?? []
      queue.push(group)
      queue.sort((a, b) => {
        const checkedA = suggest2GroupLastCheckedAt(a, byId) ?? ''
        const checkedB = suggest2GroupLastCheckedAt(b, byId) ?? ''
        if (checkedA !== checkedB) return checkedA.localeCompare(checkedB)
        return b.weightSum - a.weightSum
          || a.entity.localeCompare(b.entity)
          || a.articleIds.join(',').localeCompare(b.articleIds.join(','))
      })
      queues.set(key, queue)
    }
    return roundRobin(queues)
  }
  const unchecked: Suggest2Group[] = []
  const checked: Suggest2Group[] = []
  for (const group of groups) {
    const target = groupMetadata(group, byId, now).lastCheckedAt === null ? unchecked : checked
    target.push(group)
  }
  return [...order(unchecked), ...order(checked)]
}

export function completedSuggest2ArticleIds(
  results: Array<{ articleIds: string[]; outcome: 'approved' | 'rejected' | 'failed' }>,
): string[] {
  return [...new Set(results
    .filter((result) => result.outcome !== 'failed')
    .flatMap((result) => result.articleIds))]
}

export function excludeCurrentFreshCohorts(
  articles: RawArticle[],
  now = new Date(),
): { backlog: RawArticle[]; excludedRunIds: string[] } {
  const latestRun = (origin: 'rss' | 'correspondent') => articles
    .filter((article) => article.origin === origin && article.ingestion_run_id)
    .sort((a, b) => (b.fetched_at ?? '').localeCompare(a.fetched_at ?? ''))[0]
    ?.ingestion_run_id ?? null
  const rssRun = latestRun('rss')
  const correspondentRun = latestRun('correspondent')
  const correspondentLatest = correspondentRun
    ? articles.filter((article) =>
      article.origin === 'correspondent' && article.ingestion_run_id === correspondentRun
    )
      .reduce<string | null>((latest, article) =>
        !latest || (article.fetched_at ?? '') > latest ? article.fetched_at ?? latest : latest,
      null)
    : null
  const correspondentAge = correspondentLatest
    ? now.getTime() - Date.parse(correspondentLatest)
    : Number.POSITIVE_INFINITY
  const correspondentFresh = correspondentAge >= 0
    && correspondentAge <= INITIAL_SUGGEST2_CORRESPONDENT_FRESHNESS_HOURS * 3_600_000
  const excludedRunIds = [rssRun, correspondentFresh ? correspondentRun : null]
    .filter((runId): runId is string => Boolean(runId))
  return {
    backlog: articles.filter((article) =>
      !(article.origin === 'rss' && article.ingestion_run_id === rssRun)
      && !(article.origin === 'correspondent' && correspondentFresh
        && article.ingestion_run_id === correspondentRun)
    ),
    excludedRunIds,
  }
}
