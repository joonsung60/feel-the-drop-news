/* eslint-disable @typescript-eslint/no-explicit-any */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const ROOT = process.cwd()
const LOG_DIR = path.join(ROOT, 'logs')
const OUTPUT_JSON = path.join(ROOT, 'research/suggest-pool-d-fidelity-2026-08-05.json')
const OUTPUT_MD = path.join(ROOT, 'research/suggest-pool-d-fidelity-2026-08-05.md')
const REFERENCE_AT = '2026-08-04T08:51:24.059Z'
const BATCH_START = '2026-08-04T08:46:35Z'
const BATCH_END = '2026-08-04T08:49:30Z'
const LIMITS = [100, 120, 200]

type Article = {
  id: string
  url: string
  source_id: string | number | null
  published_at: string | null
  fetched_at: string
  suggestion_last_checked_at: string | null
  suggestion_rejected_at: string | null
  suggestion_used_at: string | null
  origin: string | null
  sourceName?: string
}

type LogEvent = {
  ts: string
  run_id: string
  pipeline: string
  stage: string
  item_url: string | null
  detail: Record<string, any>
}

type Cohort = {
  runId: string
  pipeline: 'collect' | 'correspondent'
  startedAt: string
  articleIds: string[]
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} environment variable is required`)
  return value
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4))
}

function readLogEvents(): LogEvent[] {
  return fs.readdirSync(LOG_DIR)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => fs.readFileSync(path.join(LOG_DIR, name), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogEvent))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
}

function isEligibleAt(article: Article): boolean {
  if (Date.parse(article.fetched_at) > Date.parse(REFERENCE_AT)) return false
  return ![
    article.suggestion_last_checked_at,
    article.suggestion_rejected_at,
    article.suggestion_used_at,
  ].some((value) => value && Date.parse(value) <= Date.parse(REFERENCE_AT))
}

function productionOrder(a: Article, b: Article): number {
  if (a.published_at === null && b.published_at !== null) return -1
  if (a.published_at !== null && b.published_at === null) return 1
  if (a.published_at && b.published_at) {
    const delta = Date.parse(b.published_at) - Date.parse(a.published_at)
    if (delta !== 0) return delta
  }
  return Date.parse(b.fetched_at) - Date.parse(a.fetched_at)
}

function sourceFair(items: Article[], previouslyCandidateIds: Set<string>): Article[] {
  const groups = new Map<string, Article[]>()
  for (const article of [...items].sort((a, b) => {
    const seenDelta =
      Number(previouslyCandidateIds.has(a.id)) - Number(previouslyCandidateIds.has(b.id))
    return seenDelta || productionOrder(a, b)
  })) {
    const key = article.sourceName ?? `${article.origin ?? 'unknown'}:unknown`
    const group = groups.get(key) ?? []
    group.push(article)
    groups.set(key, group)
  }
  const keys = [...groups.keys()].sort()
  const result: Article[] = []
  while (keys.some((key) => (groups.get(key)?.length ?? 0) > 0)) {
    for (const key of keys) {
      const next = groups.get(key)?.shift()
      if (next) result.push(next)
    }
  }
  return result
}

function scheduledQueues(
  candidates: Article[],
  newestByOrigin: Map<string, Set<string>>,
  previouslyCandidateIds: Set<string>,
  weighted: boolean,
): Article[] {
  const queues = new Map<string, Article[]>()
  for (const article of candidates) {
    const origin = article.origin === 'correspondent'
      ? 'correspondent'
      : article.origin === 'rss' ? 'rss' : 'legacy'
    const cohort = newestByOrigin.get(origin)?.has(article.id) ? 'cohort' : 'backlog'
    const published = article.published_at === null ? 'null' : 'dated'
    const key = weighted
      ? `${origin}:${cohort}:${published}`
      : `${origin}:${published}`
    const queue = queues.get(key) ?? []
    queue.push(article)
    queues.set(key, queue)
  }
  for (const [key, queue] of queues) {
    queues.set(key, sourceFair(queue, previouslyCandidateIds))
  }
  const originalWeights: Record<string, number> = {
    'rss:cohort:dated': 4,
    'rss:cohort:null': 4,
    'correspondent:cohort:dated': 3,
    'correspondent:cohort:null': 3,
    'rss:backlog:dated': 1,
    'rss:backlog:null': 1,
    'correspondent:backlog:dated': 1,
    'correspondent:backlog:null': 1,
    'legacy:backlog:dated': 1,
    'legacy:backlog:null': 1,
  }
  const schedule = weighted
    ? Object.entries(originalWeights)
      .flatMap(([key, weight]) => Array.from({ length: weight }, () => key))
    : [
      'rss:dated',
      'rss:null',
      'correspondent:dated',
      'correspondent:null',
      'legacy:dated',
      'legacy:null',
    ]
  const result: Article[] = []
  while ([...queues.values()].some((queue) => queue.length > 0)) {
    let progressed = false
    for (const key of schedule) {
      const next = queues.get(key)?.shift()
      if (next) {
        result.push(next)
        progressed = true
      }
    }
    if (!progressed) break
  }
  return result
}

function selectHybrid(
  candidates: Article[],
  targetIds: Set<string>,
  newestByOrigin: Map<string, Set<string>>,
  previouslyCandidateIds: Set<string>,
  limit: number,
  weighted: boolean,
): Article[] {
  const entitlement = Math.min(targetIds.size, Math.ceil(limit * 0.7))
  const cohort = sourceFair(
    candidates.filter((article) => targetIds.has(article.id)),
    previouslyCandidateIds,
  ).slice(0, entitlement)
  const remainder = scheduledQueues(
    candidates.filter((article) => !targetIds.has(article.id)),
    newestByOrigin,
    previouslyCandidateIds,
    weighted,
  )
  return [...cohort, ...remainder].slice(0, limit)
}

function loadLabels(): Map<string, string> {
  const result = new Map<string, string>()
  for (const name of [
    'entity-recall-audit-2026-08-04.json',
    'entity-merge-readiness-2026-08-04.json',
  ]) {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'research', name), 'utf8'))
    for (const article of data.articles ?? []) {
      if (article.editorial_label) result.set(article.article_id, article.editorial_label)
    }
    for (const batch of data.batches ?? []) {
      for (const article of batch.articles ?? []) {
        if (article.editorial_label) result.set(article.article_id, article.editorial_label)
      }
    }
  }
  return result
}

function metrics(
  selected: Article[],
  labels: Map<string, string>,
  targetIds: Set<string>,
  correspondentIds: Set<string>,
  newestIds: Set<string>,
  candidateIds: Set<string>,
) {
  const ids = new Set(selected.map(({ id }) => id))
  const relevant = [...targetIds].filter((id) =>
    candidateIds.has(id) && labels.get(id) === 'editorially_relevant'
  )
  const correspondentSelected = selected.filter((article) => correspondentIds.has(article.id))
  const backlogAvailable = [...candidateIds].filter((id) => !newestIds.has(id))
  const backlogSelected = selected.filter((article) => !newestIds.has(article.id))
  return {
    articleIds: selected.map(({ id }) => id),
    selected: selected.length,
    relevantRecall: ratio(relevant.filter((id) => ids.has(id)).length, relevant.length),
    originCounts: Object.fromEntries(
      ['rss', 'correspondent', 'url', 'unknown'].map((origin) => [
        origin,
        selected.filter((article) => (article.origin ?? 'unknown') === origin).length,
      ]),
    ),
    correspondentCoverage: {
      selected: correspondentSelected.length,
      available: correspondentIds.size,
      share: ratio(correspondentSelected.length, correspondentIds.size),
    },
    backlogCoverage: {
      selected: backlogSelected.length,
      available: backlogAvailable.length,
      share: ratio(backlogSelected.length, backlogAvailable.length),
    },
    sourceDiversity: new Set(selected.map((article) =>
      article.sourceName ?? `${article.origin ?? 'unknown'}:unknown`
    )).size,
    nullPublishedShare: ratio(
      selected.filter((article) => article.published_at === null).length,
      selected.length,
    ),
  }
}

async function fetchAll(client: any, table: string, select: string): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(select).range(from, from + 999)
    if (error) throw new Error(`${table} SELECT failed: ${error.message}`)
    rows.push(...(data ?? []))
    if ((data?.length ?? 0) < 1000) return rows
  }
}

async function main() {
  const client = createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const [rawRows, sources] = await Promise.all([
    fetchAll(
      client,
      'raw_articles',
      'id,url,source_id,published_at,fetched_at,suggestion_last_checked_at,suggestion_rejected_at,suggestion_used_at,origin',
    ),
    fetchAll(client, 'rss_sources', 'id,name'),
  ])
  const sourceNames = new Map(sources.map((source) => [String(source.id), source.name]))
  const articles: Article[] = rawRows.map((article) => ({
    ...article,
    sourceName: article.source_id === null
      ? undefined
      : sourceNames.get(String(article.source_id)),
  }))
  const byUrl = new Map(articles.map((article) => [article.url, article]))
  const events = readLogEvents()
  const firstCandidateAt = new Map<string, string>()
  for (const event of events.filter((event) =>
    event.pipeline === 'suggest' && event.stage === 'entity_match'
  )) {
    const id = event.detail.article_id
    if (typeof id === 'string' && !firstCandidateAt.has(id)) firstCandidateAt.set(id, event.ts)
  }
  const previouslyCandidateIds = new Set(
    [...firstCandidateAt].filter(([, timestamp]) =>
      Date.parse(timestamp) < Date.parse(REFERENCE_AT)
    ).map(([id]) => id),
  )
  const runEvents = new Map<string, LogEvent[]>()
  for (const event of events) {
    const group = runEvents.get(event.run_id) ?? []
    group.push(event)
    runEvents.set(event.run_id, group)
  }
  const cohorts: Cohort[] = []
  for (const [runId, group] of runEvents) {
    const pipeline = group[0]?.pipeline
    if (pipeline !== 'collect' && pipeline !== 'correspondent') continue
    const insertStages = pipeline === 'collect' ? ['item_inserted'] : ['inserted']
    const articleIds = group
      .filter((event) => insertStages.includes(event.stage) && event.item_url)
      .map((event) => byUrl.get(event.item_url!)?.id)
      .filter((id): id is string => Boolean(id))
    cohorts.push({
      runId,
      pipeline,
      startedAt: group[0].ts,
      articleIds: [...new Set(articleIds)],
    })
  }
  cohorts.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
  const latestRss = [...cohorts].reverse().find((cohort) =>
    cohort.pipeline === 'collect' && cohort.startedAt <= REFERENCE_AT
  )
  const latestCorrespondent = [...cohorts].reverse().find((cohort) =>
    cohort.pipeline === 'correspondent' && cohort.startedAt <= REFERENCE_AT
  )
  const candidates = articles.filter(isEligibleAt).sort(productionOrder)
  const candidateIds = new Set(candidates.map(({ id }) => id))
  const target = articles.filter((article) =>
    article.fetched_at >= BATCH_START && article.fetched_at <= BATCH_END
  )
  if (target.length !== 123) throw new Error(`expected 123 target rows, got ${target.length}`)
  const targetIds = new Set(target.map(({ id }) => id))
  const correspondentIds = new Set(
    (latestCorrespondent?.articleIds ?? []).filter((id) => candidateIds.has(id))
  )
  const newestByOrigin = new Map<string, Set<string>>([
    ['rss', new Set(latestRss?.articleIds ?? target.map(({ id }) => id))],
    ['correspondent', correspondentIds],
  ])
  const newestIds = new Set([
    ...(newestByOrigin.get('rss') ?? []),
    ...(newestByOrigin.get('correspondent') ?? []),
  ])
  const labels = loadLabels()
  const policies = Object.fromEntries(['D-original', 'D-equal'].map((policy) => [
    policy,
    Object.fromEntries(LIMITS.map((limit) => {
      const selected = selectHybrid(
        candidates,
        targetIds,
        newestByOrigin,
        previouslyCandidateIds,
        limit,
        policy === 'D-original',
      )
      return [String(limit), metrics(
        selected,
        labels,
        targetIds,
        correspondentIds,
        newestIds,
        candidateIds,
      )]
    })),
  ]))
  const output = {
    generatedAt: new Date().toISOString(),
    referenceAt: REFERENCE_AT,
    candidateCount: candidates.length,
    targetCohortCount: target.length,
    newestRssRun: latestRss?.runId ?? null,
    newestCorrespondentRun: latestCorrespondent?.runId ?? null,
    newestCorrespondentEligibleCount: correspondentIds.size,
    fidelityFinding:
      'After excluding only the designated target cohort, newestByOrigin correspondent rows remain in the remainder and receive weight 3.',
    policies,
  }
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(output, null, 2)}\n`)
  const rows = LIMITS.flatMap((limit) => ['D-original', 'D-equal'].map((policy) => {
    const value = output.policies[policy][String(limit)]
    return `| ${limit} | ${policy} | ${value.relevantRecall} | ${value.originCounts.rss}/${value.originCounts.correspondent}/${value.originCounts.url}/${value.originCounts.unknown} | ${value.correspondentCoverage.selected}/${value.correspondentCoverage.available} (${value.correspondentCoverage.share}) | ${value.backlogCoverage.selected}/${value.backlogCoverage.available} (${value.backlogCoverage.share}) | ${value.sourceDiversity} | ${value.nullPublishedShare} |`
  }))
  fs.writeFileSync(OUTPUT_MD, `# Suggest pool D-policy fidelity — 2026-08-05

The comparison uses the exact SELECT-only candidate snapshot and editorial labels from the 2026-08-04 audit. Exact article IDs are stored in the JSON.

The original audit removes only the designated 123-row RSS cohort before fair remainder selection. The latest correspondent cohort remains in \`newestByOrigin\`, so its dated/null queues receive weight 3.

| Limit | Policy | Relevant recall | RSS/Corr/URL/Unknown | Correspondent cohort | True backlog | Sources | Null share |
|---:|---|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}
`)
  console.log(JSON.stringify(output, null, 2))
}

void main()
