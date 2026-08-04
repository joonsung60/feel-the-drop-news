/* eslint-disable @typescript-eslint/no-explicit-any */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const ROOT = process.cwd()
const LOG_DIR = path.join(ROOT, 'logs')
const OUTPUT_JSON = path.join(ROOT, 'research/suggest-pool-selection-audit-2026-08-04.json')
const OUTPUT_MD = path.join(ROOT, 'research/suggest-pool-selection-audit-2026-08-04.md')
const REFERENCE_AT = '2026-08-04T08:51:24.059Z'
const BATCH_START = '2026-08-04T08:46:35Z'
const BATCH_END = '2026-08-04T08:49:30Z'
const LIMITS = [100, 120, 200]

type Article = {
  id: string
  title: string
  content: string | null
  url: string
  source_id: string | number | null
  published_at: string | null
  fetched_at: string
  event_date: string | null
  suggestion_state: string | null
  suggestion_last_checked_at: string | null
  suggestion_rejected_at: string | null
  suggestion_used_at: string | null
  facts: Record<string, unknown> | null
  origin: string | null
  doc_type: string | null
  sourceName?: string
}

type LogEvent = {
  ts: string
  run_id: string
  pipeline: string
  stage: string
  source: string | null
  item_url: string | null
  title: string | null
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

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4))
}

function readLogEvents(): LogEvent[] {
  if (!fs.existsSync(LOG_DIR)) return []
  return fs.readdirSync(LOG_DIR)
    .filter((name) => name.endsWith('.jsonl'))
    .flatMap((name) => fs.readFileSync(path.join(LOG_DIR, name), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LogEvent))
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))
}

function stateAt(article: Article, at: string): 'eligible' | 'excluded' | 'not_fetched' {
  const timestamp = Date.parse(at)
  if (Date.parse(article.fetched_at) > timestamp) return 'not_fetched'
  const transitions = [
    article.suggestion_last_checked_at,
    article.suggestion_rejected_at,
    article.suggestion_used_at,
  ].filter((value): value is string => Boolean(value))
  return transitions.some((value) => Date.parse(value) <= timestamp) ? 'excluded' : 'eligible'
}

function productionOrder(a: Article, b: Article): number {
  if (a.published_at === null && b.published_at !== null) return -1
  if (a.published_at !== null && b.published_at === null) return 1
  if (a.published_at && b.published_at) {
    const publishedDelta = Date.parse(b.published_at) - Date.parse(a.published_at)
    if (publishedDelta !== 0) return publishedDelta
  }
  return Date.parse(b.fetched_at) - Date.parse(a.fetched_at)
}

function sourceFair(items: Article[], previouslyCandidateIds = new Set<string>()): Article[] {
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
  const result: Article[] = []
  const keys = [...groups.keys()].sort()
  while (keys.some((key) => (groups.get(key)?.length ?? 0) > 0)) {
    for (const key of keys) {
      const next = groups.get(key)?.shift()
      if (next) result.push(next)
    }
  }
  return result
}

function cohortFirst(
  candidates: Article[],
  cohortIds: Set<string>,
  previouslyCandidateIds: Set<string>,
): Article[] {
  const cohort = sourceFair(
    candidates.filter((article) => cohortIds.has(article.id)),
    previouslyCandidateIds,
  )
  const backlog = sourceFair(
    candidates.filter((article) => !cohortIds.has(article.id)),
    previouslyCandidateIds,
  )
  return [...cohort, ...backlog]
}

function fairMultiQueue(
  candidates: Article[],
  newestByOrigin: Map<string, Set<string>>,
  previouslyCandidateIds: Set<string>,
): Article[] {
  const queues = new Map<string, Article[]>()
  for (const article of candidates) {
    const origin = article.origin === 'correspondent'
      ? 'correspondent'
      : article.origin === 'rss' ? 'rss' : 'legacy'
    const cohort = newestByOrigin.get(origin)?.has(article.id) ? 'cohort' : 'backlog'
    const published = article.published_at === null ? 'null' : 'dated'
    const key = `${origin}:${cohort}:${published}`
    const queue = queues.get(key) ?? []
    queue.push(article)
    queues.set(key, queue)
  }
  for (const [key, queue] of queues) {
    queues.set(key, sourceFair(queue, previouslyCandidateIds))
  }

  const weights: Record<string, number> = {
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
  const schedule = Object.entries(weights)
    .flatMap(([key, weight]) => Array.from({ length: weight }, () => key))
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

function cohortEntitlementHybrid(
  candidates: Article[],
  cohortIds: Set<string>,
  newestByOrigin: Map<string, Set<string>>,
  previouslyCandidateIds: Set<string>,
  limit: number,
): Article[] {
  const entitlement = Math.min(cohortIds.size, Math.ceil(limit * 0.7))
  const cohort = sourceFair(
    candidates.filter((article) => cohortIds.has(article.id)),
    previouslyCandidateIds,
  ).slice(0, entitlement)
  const selectedIds = new Set(cohort.map(({ id }) => id))
  const fairRemainder = fairMultiQueue(
    candidates.filter((article) =>
      !cohortIds.has(article.id) && !selectedIds.has(article.id)
    ),
    newestByOrigin,
    previouslyCandidateIds,
  )
  return [...cohort, ...fairRemainder].slice(0, limit)
}

function selectionMetrics(
  selected: Article[],
  targetIds: Set<string>,
  labels: Map<string, string>,
  previouslyCandidateIds: Set<string>,
  at: string,
) {
  const selectedIds = new Set(selected.map(({ id }) => id))
  const targetSelected = [...targetIds].filter((id) => selectedIds.has(id))
  const labeledTarget = [...targetIds].filter((id) => labels.has(id))
  const relevant = labeledTarget.filter((id) => labels.get(id) === 'editorially_relevant')
  const irrelevant = targetSelected.filter((id) => labels.get(id) === 'editorially_irrelevant')
  const sources = new Map<string, number>()
  for (const article of selected) {
    const source = article.sourceName ?? `${article.origin ?? 'unknown'}:unknown`
    sources.set(source, (sources.get(source) ?? 0) + 1)
  }
  const maxSourceCount = Math.max(0, ...sources.values())
  const postEventPattern =
    /\b(?:death|dies?|died|fatal|cancel|ends? early|aftermovie|review|recap|arrest|investigation)\b|사망|취소|조기\s*종료|리뷰|후기/i
  const previewPattern =
    /\b(?:preview|lineup|announc|tickets?|schedule|set times?)\b|예고|라인업|티켓|일정|출연/i
  const atDate = at.slice(0, 10)
  const stalePreviewRisk = selected.filter((article) =>
    Boolean(article.event_date)
    && article.event_date! < atDate
    && previewPattern.test(`${article.title} ${(article.content ?? '').slice(0, 500)}`)
    && !postEventPattern.test(`${article.title} ${(article.content ?? '').slice(0, 500)}`)
  )
  return {
    selected: selected.length,
    articleIds: selected.map(({ id }) => id),
    latestBatchSelected: targetSelected.length,
    latestBatchCoverage: ratio(targetSelected.length, targetIds.size),
    editorialRelevantRecall: ratio(
      relevant.filter((id) => selectedIds.has(id)).length,
      relevant.length,
    ),
    irrelevantInclusion: irrelevant.length,
    originCounts: Object.fromEntries(
      ['rss', 'correspondent', 'url', 'unknown'].map((origin) => [
        origin,
        selected.filter((article) => (article.origin ?? 'unknown') === origin).length,
      ]),
    ),
    sourceDiversity: sources.size,
    maxSourceShare: ratio(maxSourceCount, selected.length),
    nullPublishedShare: ratio(
      selected.filter((article) => article.published_at === null).length,
      selected.length,
    ),
    backlogSelected: selected.filter((article) => !targetIds.has(article.id)).length,
    stalePreviewRisk: stalePreviewRisk.map(({ id }) => id),
    repeatedCandidateRisk: selected
      .filter((article) => previouslyCandidateIds.has(article.id))
      .map(({ id }) => id),
  }
}

function loadEditorialLabels(): Map<string, string> {
  const labels = new Map<string, string>()
  const recall = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'research/entity-recall-audit-2026-08-04.json'),
    'utf8',
  ))
  for (const article of recall.articles ?? []) {
    labels.set(article.article_id, article.editorial_label)
  }
  const readiness = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'research/entity-merge-readiness-2026-08-04.json'),
    'utf8',
  ))
  for (const batch of readiness.batches ?? []) {
    for (const article of batch.articles ?? []) {
      if (article.editorial_label) labels.set(article.article_id, article.editorial_label)
    }
  }
  return labels
}

async function fetchAll(supabase: any, table: string, select: string): Promise<any[]> {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + 999)
    if (error) throw new Error(`${table} SELECT failed: ${error.message}`)
    rows.push(...(data ?? []))
    if ((data?.length ?? 0) < 1000) return rows
  }
}

function markdown(output: any): string {
  const rows = LIMITS.flatMap((limit) => ['A', 'B', 'C', 'D'].map((policy) => {
    const metric = output.policies[policy][String(limit)]
    return `| ${limit} | ${policy} | ${metric.latestBatchSelected} (${metric.latestBatchCoverage}) | ${metric.editorialRelevantRecall} | ${metric.irrelevantInclusion} | ${metric.originCounts.rss}/${metric.originCounts.correspondent} | ${metric.sourceDiversity} | ${metric.nullPublishedShare} | ${metric.backlogSelected} | ${metric.stalePreviewRisk.length} |`
  }))
  const exact = output.referenceBatch.productionReproduction
  const rss = output.cohortWindow.byPath.collect
  const correspondent = output.cohortWindow.byPath.correspondent
  return `# Suggest pool selection audit — 2026-08-04

## 결론

현재 정책은 \`published_at DESC\` 단일 queue이며 DESC의 null-first 동작 때문에 발행일이 비어 있는 correspondent/backlog가 상단을 점유한다. 2026-08-04 RSS 123건 중 실제 suggest pool에 들어간 것은 3건뿐이었다. fetched_at 단독 정렬은 권장하지 않는다.

권장안은 **D cohort entitlement + fair remainder**다. limit의 70%를 최신 cohort에 보장하고 나머지를 RSS/correspondent/legacy, published-at 있음/없음, backlog queue에 weighted round-robin으로 배분한다. 최신 batch와 backlog 어느 쪽도 0이 되지 않는다. 운영상 긴급한 새 collect 전체 처리가 필요할 때만 B를 명시적 one-shot mode로 사용한다.

## Production 재현

- reference suggest: ${output.referenceAt}
- 실제 pool: ${exact.poolSize}
- 2026-08-04 RSS batch 포함: ${exact.batchSelected} / 123
- 포함 rank: ${exact.selectedRanks.join(', ')}
- 밀린 기사: ${exact.displaced.length}
- 주원인: ${exact.primaryReason}

## 정책 비교

| Limit | Policy | 최신 batch | Relevant recall | Irrelevant | RSS/Corr | Sources | Null share | Backlog | Stale preview risk |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}

Relevant recall과 irrelevant inclusion은 editorial ground truth가 있는 2026-08-04 exact 123건 안에서 계산했다. A/100은 실제 production log이며, 나머지는 같은 시점의 상태를 재구성한 시뮬레이션이다.

## 정책 정의

- A: production과 동일한 eligible-state + \`published_at DESC\` 단일 queue.
- B: 최신 acquisition cohort를 source round-robin으로 먼저 소비하고 남는 limit을 backlog로 채움.
- C: origin × cohort/backlog × published-null/dated queue를 만들고 가중치 4/3/1로 weighted round-robin. 각 queue 내부도 source round-robin.
- D: limit의 70%를 최신 cohort에 source-fair entitlement로 배정하고, 나머지 30%를 C의 fair backlog queue로 채움.

## Event date

\`event_date < today\`만으로 제외하지 않는다. 제목과 본문 500자에서 preview 신호와 post-event 신호를 나눠 stale preview 위험만 보고한다. death/cancellation/review/aftermovie 같은 후속 보도는 과거 event_date여도 유지한다. 현재 facts에는 correspondent gate와 일부 구조화 사실이 있지만 news lifecycle을 일관되게 표현하는 필드는 없어 텍스트 휴리스틱만으로 완전한 분리는 불가능하다.

## RSS와 correspondent

| Path | Collected | Published null | Event null | Content p50/p90 | Current top100 | Reached suggest | Never candidate | Article age p50/p90 h | First-suggest p50/p90 h | Sources | Max source share |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| RSS collect | ${rss.collected} | ${rss.publishedAtNullRate} | ${rss.eventDateNullRate} | ${rss.contentLength.p50}/${rss.contentLength.p90} | ${rss.currentTop100Included} (${rss.currentTop100IncludedRate}) | ${rss.reachedSuggest} (${rss.reachedSuggestRate}) | ${rss.neverCandidate} | ${rss.articleAgeHours.p50}/${rss.articleAgeHours.p90} | ${rss.collectToFirstSuggestHours.p50}/${rss.collectToFirstSuggestHours.p90} | ${rss.sourceDiversity} | ${rss.maxSourceShare} |
| Correspondent | ${correspondent.collected} | ${correspondent.publishedAtNullRate} | ${correspondent.eventDateNullRate} | ${correspondent.contentLength.p50}/${correspondent.contentLength.p90} | ${correspondent.currentTop100Included} (${correspondent.currentTop100IncludedRate}) | ${correspondent.reachedSuggest} (${correspondent.reachedSuggestRate}) | ${correspondent.neverCandidate} | ${correspondent.articleAgeHours.p50}/${correspondent.articleAgeHours.p90} | ${correspondent.collectToFirstSuggestHours.p50}/${correspondent.collectToFirstSuggestHours.p90} | ${correspondent.sourceDiversity} | ${correspondent.maxSourceShare} |

- RSS: feed publication date를 \`published_at\`에 저장하고 원문 추출 content를 저장한다. \`event_date\`, \`facts\`, \`doc_type\`은 보통 비어 있다.
- Correspondent: LLM 정제 summary, grounded \`event_date\`, \`doc_type\`, facts와 gate metadata를 저장한다. HTML publication date가 없으면 \`published_at=null\`을 의도적으로 보존한다.
- 양쪽 모두 URL 중복 시 기존 row를 update/enrich하지 않는다. RSS는 사전 SELECT 후 skip, correspondent는 \`on_conflict=url, resolution=ignore-duplicates\`이다.

## 권장 pseudocode

\`\`\`sql
-- Read-only snapshot input. Cohort membership is resolved from the acquisition-run
-- boundary in application code; fetched_at is a tie-breaker, not the sole policy.
SELECT id, title, content, url, source_id, origin, published_at, fetched_at,
       event_date, suggestion_state, facts
FROM raw_articles
WHERE suggestion_state IS NULL OR suggestion_state = 'new';
\`\`\`

\`\`\`ts
const eligible = queryRawArticlesAtSnapshot()
const queues = partition(eligible, [
  origin: ['rss', 'correspondent', 'legacy'],
  cohort: ['latest_run', 'backlog'],
  publication: ['dated', 'null'],
])
for (const queue of queues) queue.orderBy(sourceRoundRobinThenPublishedAndFetched())
const latest = sourceRoundRobin(queues.latestCohort).take(Math.ceil(limit * 0.7))
const remainder = weightedRoundRobin(queues.without(latestCohort), {
  rss_latest: 4,
  correspondent_latest: 3,
  rss_backlog: 1,
  correspondent_backlog: 1,
  legacy_backlog: 1,
}, limit - latest.length)
return [...latest, ...remainder]
\`\`\`

정확한 article ID 목록은 JSON의 \`policies.{A|B|C|D}.{100|120|200}.articleIds\`에 있다.

## 예상 production diff

- \`app/api/suggest-clusters/route.ts\`: 단일 query를 cohort metadata 조회 + queue selector 호출로 교체.
- 신규 \`lib/suggest/pool-selection.ts\`: deterministic queue 구성, source fairness, limit 처리.
- tests: null published, mixed origin, cohort overflow, repeated-state, post-event 사례.
- migration: **불필요**. 기존 \`origin\`, \`fetched_at\`, \`published_at\`, state timestamp로 구현 가능하다. 장기적으로 정확한 run ID를 저장하려면 별도 migration을 후속 검토한다.

## 남은 위험과 rollback

- fetched_at gap 기반 cohort 추론은 동시/장시간 run에서 부정확할 수 있다.
- correspondent source name이 raw row에 없어 source-level fairness가 origin 수준으로 축약된다.
- selection 개선 후에도 RSS 본문 추출 실패, correspondent publication-date 부재, duplicate enrichment 부재는 남는다.
- rollback은 selector feature flag를 끄고 기존 단일 query로 복귀한다. DB migration이 없어 데이터 rollback은 필요 없다.
`
}

async function main() {
  const supabase = createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const [rawRows, sources, suggestions] = await Promise.all([
    fetchAll(
      supabase,
      'raw_articles',
      'id,title,content,url,source_id,published_at,fetched_at,event_date,suggestion_state,suggestion_last_checked_at,suggestion_rejected_at,suggestion_used_at,facts,origin,doc_type',
    ),
    fetchAll(supabase, 'rss_sources', 'id,name'),
    fetchAll(supabase, 'suggested_clusters', 'article_ids,created_at,status'),
  ])
  const sourceNames = new Map(sources.map((source) => [String(source.id), source.name]))
  const articles: Article[] = rawRows.map((article) => ({
    ...article,
    sourceName: article.source_id === null
      ? undefined
      : sourceNames.get(String(article.source_id)),
  }))
  const articleById = new Map(articles.map((article) => [article.id, article]))
  const articleByUrl = new Map(articles.map((article) => [article.url, article]))
  const events = readLogEvents()
  const suggestEvents = events.filter((event) => event.pipeline === 'suggest')
  const firstCandidateAt = new Map<string, string>()
  for (const event of suggestEvents.filter((event) => event.stage === 'entity_match')) {
    const id = event.detail.article_id
    if (typeof id === 'string' && !firstCandidateAt.has(id)) firstCandidateAt.set(id, event.ts)
  }
  const everCandidateIds = new Set(firstCandidateAt.keys())
  const previouslyCandidateIds = new Set(
    [...firstCandidateAt.entries()]
      .filter(([, timestamp]) => Date.parse(timestamp) < Date.parse(REFERENCE_AT))
      .map(([id]) => id),
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
    const ids = group
      .filter((event) => insertStages.includes(event.stage) && event.item_url)
      .map((event) => articleByUrl.get(event.item_url!)?.id)
      .filter((id): id is string => Boolean(id))
    cohorts.push({
      runId,
      pipeline,
      startedAt: group[0].ts,
      articleIds: [...new Set(ids)],
    })
  }
  cohorts.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))

  const referenceCandidates = articles
    .filter((article) => stateAt(article, REFERENCE_AT) === 'eligible')
    .sort(productionOrder)
  const targetArticles = articles.filter((article) =>
    article.fetched_at >= BATCH_START && article.fetched_at <= BATCH_END
  )
  if (targetArticles.length !== 123) {
    throw new Error(`expected exact 123 reference articles, got ${targetArticles.length}`)
  }
  const targetIds = new Set(targetArticles.map(({ id }) => id))

  const referenceRun = [...runEvents.entries()].find(([runId]) =>
    runId.startsWith('suggest-2026-08-04T08:51:24.059Z')
  )
  if (!referenceRun) throw new Error('reference suggest log not found')
  const actualPoolIds = referenceRun[1]
    .filter((event) => event.stage === 'entity_match')
    .map((event) => String(event.detail.article_id))
  const actualPoolSet = new Set(actualPoolIds)
  const actualTarget = actualPoolIds.filter((id) => targetIds.has(id))
  if (actualPoolIds.length !== 100 || actualTarget.length !== 3) {
    throw new Error(
      `production reproduction mismatch: pool=${actualPoolIds.length}, target=${actualTarget.length}`,
    )
  }

  const latestRssCohort = [...cohorts]
    .reverse()
    .find((cohort) => cohort.pipeline === 'collect' && cohort.startedAt <= REFERENCE_AT)
  const latestCorrespondentCohort = [...cohorts]
    .reverse()
    .find((cohort) => cohort.pipeline === 'correspondent' && cohort.startedAt <= REFERENCE_AT)
  const newestByOrigin = new Map<string, Set<string>>([
    ['rss', new Set(latestRssCohort?.articleIds ?? targetArticles.map(({ id }) => id))],
    ['correspondent', new Set(latestCorrespondentCohort?.articleIds ?? [])],
  ])
  const labels = loadEditorialLabels()
  const ordered = {
    A: referenceCandidates,
    B: cohortFirst(referenceCandidates, targetIds, previouslyCandidateIds),
    C: fairMultiQueue(referenceCandidates, newestByOrigin, previouslyCandidateIds),
  }
  const policyNames = ['A', 'B', 'C', 'D'] as const
  const policies = Object.fromEntries(policyNames.map((name) => [
    name,
    Object.fromEntries(LIMITS.map((limit) => {
      const selected = name === 'A' && limit === 100
        ? actualPoolIds
          .map((id) => articleById.get(id))
          .filter((article): article is Article => Boolean(article))
        : name === 'D'
          ? cohortEntitlementHybrid(
            referenceCandidates,
            targetIds,
            newestByOrigin,
            previouslyCandidateIds,
            limit,
          )
          : ordered[name].slice(0, limit)
      return [
        String(limit),
        {
          ...selectionMetrics(
            selected,
            targetIds,
            labels,
            previouslyCandidateIds,
            REFERENCE_AT,
          ),
          basis: name === 'A' && limit === 100
            ? 'actual production pool log'
            : 'timestamp-reconstructed simulation',
        },
      ]
    })),
  ]))

  const latestTenRss = cohorts.filter((cohort) => cohort.pipeline === 'collect').slice(-10)
  const cohortStart = latestTenRss[0]?.startedAt ?? BATCH_START
  const analyzedCohorts = cohorts.filter((cohort) =>
    cohort.pipeline === 'collect'
    ? latestTenRss.some(({ runId }) => runId === cohort.runId)
    : cohort.startedAt >= cohortStart
  )
  const currentEligible = articles
    .filter((article) => article.suggestion_state === null || article.suggestion_state === 'new')
    .sort(productionOrder)
  const currentTop100 = new Set(currentEligible.slice(0, 100).map(({ id }) => id))
  const cohortMetrics = analyzedCohorts.map((cohort) => {
    const rows = cohort.articleIds
      .map((id) => articleById.get(id))
      .filter((article): article is Article => Boolean(article))
    const firstSuggest = rows
      .map((article) => firstCandidateAt.get(article.id))
      .filter((value): value is string => Boolean(value))
    const states = new Map<string, number>()
    for (const row of rows) {
      const state = row.suggestion_state ?? 'null'
      states.set(state, (states.get(state) ?? 0) + 1)
    }
    const sourcesInCohort = new Map<string, number>()
    for (const row of rows) {
      const source = row.sourceName ?? `${row.origin ?? 'unknown'}:unknown`
      sourcesInCohort.set(source, (sourcesInCohort.get(source) ?? 0) + 1)
    }
    const contentLengths = rows.map((row) => row.content?.length ?? 0)
    const ageHours = rows
      .filter((row) => row.published_at)
      .map((row) => (
        Date.parse(firstCandidateAt.get(row.id) ?? REFERENCE_AT) - Date.parse(row.published_at!)
      ) / 3_600_000)
    const collectToSuggestHours = rows
      .filter((row) => firstCandidateAt.has(row.id))
      .map((row) => (
        Date.parse(firstCandidateAt.get(row.id)!) - Date.parse(row.fetched_at)
      ) / 3_600_000)
    return {
      runId: cohort.runId,
      pipeline: cohort.pipeline,
      startedAt: cohort.startedAt,
      collected: rows.length,
      publishedAtNullRate: ratio(rows.filter((row) => !row.published_at).length, rows.length),
      eventDateNullRate: ratio(rows.filter((row) => !row.event_date).length, rows.length),
      contentLength: {
        min: contentLengths.length ? Math.min(...contentLengths) : null,
        p50: percentile(contentLengths, 0.5),
        p90: percentile(contentLengths, 0.9),
        max: contentLengths.length ? Math.max(...contentLengths) : null,
      },
      suggestionStates: Object.fromEntries(states),
      currentTop100Included: rows.filter((row) => currentTop100.has(row.id)).length,
      currentTop100IncludedRate: ratio(
        rows.filter((row) => currentTop100.has(row.id)).length,
        rows.length,
      ),
      reachedSuggest: firstSuggest.length,
      reachedSuggestRate: ratio(firstSuggest.length, rows.length),
      collectToFirstSuggestHours: {
        p50: percentile(collectToSuggestHours, 0.5),
        p90: percentile(collectToSuggestHours, 0.9),
      },
      neverCandidate: rows.filter((row) => !everCandidateIds.has(row.id)).map(({ id }) => id),
      articleAgeHours: {
        p50: percentile(ageHours, 0.5),
        p90: percentile(ageHours, 0.9),
      },
      sourceDiversity: sourcesInCohort.size,
      maxSourceShare: ratio(Math.max(0, ...sourcesInCohort.values()), rows.length),
    }
  })
  const pathAggregates = Object.fromEntries(
    (['collect', 'correspondent'] as const).map((pipeline) => {
      const ids = new Set(
        analyzedCohorts
          .filter((cohort) => cohort.pipeline === pipeline)
          .flatMap((cohort) => cohort.articleIds),
      )
      const rows = [...ids]
        .map((id) => articleById.get(id))
        .filter((article): article is Article => Boolean(article))
      const contentLengths = rows.map((row) => row.content?.length ?? 0)
      const sourceCounts = new Map<string, number>()
      const states = new Map<string, number>()
      for (const row of rows) {
        const source = row.sourceName ?? `${row.origin ?? 'unknown'}:unknown`
        sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1)
        const state = row.suggestion_state ?? 'null'
        states.set(state, (states.get(state) ?? 0) + 1)
      }
      const reached = rows.filter((row) => firstCandidateAt.has(row.id))
      const latency = reached.map((row) => (
        Date.parse(firstCandidateAt.get(row.id)!) - Date.parse(row.fetched_at)
      ) / 3_600_000)
      const ageHours = rows
        .filter((row) => row.published_at)
        .map((row) => (
          Date.parse(firstCandidateAt.get(row.id) ?? REFERENCE_AT) - Date.parse(row.published_at!)
        ) / 3_600_000)
      return [pipeline, {
        collected: rows.length,
        publishedAtNullRate: ratio(rows.filter((row) => !row.published_at).length, rows.length),
        eventDateNullRate: ratio(rows.filter((row) => !row.event_date).length, rows.length),
        contentLength: {
          p50: percentile(contentLengths, 0.5),
          p90: percentile(contentLengths, 0.9),
        },
        suggestionStates: Object.fromEntries(states),
        currentTop100Included: rows.filter((row) => currentTop100.has(row.id)).length,
        currentTop100IncludedRate: ratio(
          rows.filter((row) => currentTop100.has(row.id)).length,
          rows.length,
        ),
        reachedSuggest: reached.length,
        reachedSuggestRate: ratio(reached.length, rows.length),
        collectToFirstSuggestHours: {
          p50: percentile(latency, 0.5),
          p90: percentile(latency, 0.9),
        },
        neverCandidate: rows.filter((row) => !everCandidateIds.has(row.id)).length,
        articleAgeHours: {
          p50: percentile(ageHours, 0.5),
          p90: percentile(ageHours, 0.9),
        },
        sourceDiversity: sourceCounts.size,
        maxSourceShare: ratio(Math.max(0, ...sourceCounts.values()), rows.length),
      }]
    }),
  )

  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    mode: 'SELECT-only',
    referenceAt: REFERENCE_AT,
    referenceBatch: {
      fetchedAtStart: BATCH_START,
      fetchedAtEnd: BATCH_END,
      count: targetArticles.length,
      productionReproduction: {
        poolSize: actualPoolIds.length,
        batchSelected: actualTarget.length,
        selected: actualTarget.map((id) => ({
          id,
          rank: actualPoolIds.indexOf(id) + 1,
          title: articleById.get(id)?.title ?? null,
        })),
        selectedRanks: actualTarget.map((id) => actualPoolIds.indexOf(id) + 1),
        displaced: targetArticles
          .filter((article) => !actualPoolSet.has(article.id))
          .map((article) => {
            const nullAhead = actualPoolIds.filter((id) => !articleById.get(id)?.published_at).length
            return {
              id: article.id,
              title: article.title,
              publishedAt: article.published_at,
              fetchedAt: article.fetched_at,
              reconstructedRank: referenceCandidates.findIndex(({ id }) => id === article.id) + 1,
              reason: article.published_at === null
                ? 'null-published backlog tie/order displacement'
                : `${nullAhead} null-published rows precede dated article`,
            }
          }),
        primaryReason:
          'published_at DESC is a single queue and PostgreSQL DESC places NULL first; '
          + 'null-published correspondent/backlog rows consumed 97 of 100 slots.',
      },
    },
    currentPath: {
      query:
        "raw_articles where suggestion_state is null or 'new' "
        + 'order by published_at desc limit rounded(60..200, batch=20)',
      selectedFields: [
        'id', 'title', 'content', 'url', 'source_id', 'published_at', 'event_date', 'facts',
      ],
      fieldsNotUsedForPoolOrder: ['origin', 'fetched_at', 'event_date', 'facts'],
      nullOrdering: 'PostgreSQL DESC default: NULLS FIRST',
    },
    acquisitionPaths: {
      rss: {
        publishedAt: 'RSS pubDate/isoDate, nullable if parsing fails',
        eventDate: 'not populated',
        facts: 'not populated',
        docType: 'not populated',
        content: 'HTML extraction, up to 20,000 chars; empty on fetch failure',
        duplicate: 'SELECT by exact URL then skip; no enrichment',
      },
      correspondent: {
        publishedAt: 'HTML page publication date only; null is intentionally preserved',
        eventDate: 'grounded event/release date when resolvable',
        facts: 'normalized facts plus correspondent_gate',
        docType: 'LLM classified',
        content: 'LLM English summary bound to source segment',
        duplicate: 'on_conflict=url ignore-duplicates; no enrichment',
      },
    },
    cohortWindow: {
      latestTenRssRuns: latestTenRss.map(({ runId }) => runId),
      includedCorrespondentSince: cohortStart,
      cohorts: cohortMetrics,
      byPath: pathAggregates,
    },
    policies,
    labelCoverage: {
      labeledArticles: labels.size,
      relevant: [...labels.values()].filter((label) => label === 'editorially_relevant').length,
      irrelevant: [...labels.values()].filter((label) => label === 'editorially_irrelevant').length,
      ambiguous: [...labels.values()].filter((label) => label === 'ambiguous').length,
    },
    suggestedClusterRowsRead: suggestions.length,
    recommendation: {
      policy: 'D',
      operationalOverride: 'B for explicit one-shot full latest-cohort review',
      migrationRequired: false,
      productionDiff: [
        'app/api/suggest-clusters/route.ts',
        'new lib/suggest/pool-selection.ts',
        'new tests for deterministic pool selection',
      ],
      rollback: 'feature flag selector off; restore existing single ordered query',
    },
  }
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(output, null, 2)}\n`)
  fs.writeFileSync(OUTPUT_MD, markdown(output))
  console.log(JSON.stringify({
    outputs: [OUTPUT_JSON, OUTPUT_MD],
    rawArticles: articles.length,
    cohorts: cohortMetrics.length,
    productionReference: output.referenceBatch.productionReproduction,
    limits: policies,
  }, null, 2))
}

main().catch((error) => {
  console.error(String(error))
  process.exitCode = 1
})
