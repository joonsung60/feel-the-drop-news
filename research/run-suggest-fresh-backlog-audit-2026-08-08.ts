/* eslint-disable @typescript-eslint/no-explicit-any */

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  buildEntityIndex,
  buildPairClusters,
  loadEntityDictionary,
} from '../lib/suggest/entity-index'
import {
  hasExplicitEdmEvidence,
  partitionArticlesByEntityRole,
  selectEligibleLlmInput,
} from '../lib/suggest/eligibility'
import type { EntityEntry, RawArticle } from '../lib/suggest/types'

const ROOT = process.cwd()
const REFERENCE_AT = '2026-08-06T03:08:07.034Z'
const PREFERRED_RUN_ID = 'eb6018a4-7b23-4794-adcf-77fd06f90c79'
const SUGGEST_LOG = path.join(ROOT, 'logs/2026-08-06T03:08:07.034Z_suggest.jsonl')
const OUTPUT1_JSON = path.join(ROOT, 'research/suggest1-fresh-policy-audit-2026-08-08.json')
const OUTPUT1_MD = path.join(ROOT, 'research/suggest1-fresh-policy-audit-2026-08-08.md')
const OUTPUT2_JSON = path.join(ROOT, 'research/suggest2-backlog-audit-2026-08-08.json')
const OUTPUT2_MD = path.join(ROOT, 'research/suggest2-backlog-audit-2026-08-08.md')
const LIMIT = 100
const FRESHNESS_HOURS = [24, 72, 168]
const BACKLOG_BUDGETS = [100, 200, 500]

type Article = RawArticle & {
  fetched_at: string
  suggestion_state: string | null
  suggestion_rejected_at: string | null
  suggestion_used_at: string | null
}

type LogEvent = {
  ts: string
  run_id: string
  stage: string
  title: string | null
  detail: Record<string, any>
}

type SavedSuggestion = {
  id: string
  topic: string
  articleIds: string[]
  status?: string | null
  clusterId?: string | null
}

type GeneratedArticleLink = {
  id: string
  title: string
  clusterId: string | null
  suggestionId: string | null
  suggestionTopic: string | null
  rawArticleIds: string[]
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} environment variable is required`)
  return value
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4))
}

function originKey(article: Article): 'rss' | 'correspondent' | 'legacy' {
  if (article.origin === 'rss') return 'rss'
  if (article.origin === 'correspondent') return 'correspondent'
  return 'legacy'
}

function sourceKey(article: Article): string {
  if (article.origin === 'rss' && article.source_id !== null) {
    return `rss:${String(article.source_id)}`
  }
  return article.ingestion_source ?? `${originKey(article)}:unknown`
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

function articleOrder(a: Article, b: Article): number {
  const checkedA = a.suggestion_last_checked_at
  const checkedB = b.suggestion_last_checked_at
  if (checkedA === null && checkedB !== null) return -1
  if (checkedA !== null && checkedB === null) return 1
  if (checkedA && checkedB) {
    const checkedDelta = Date.parse(checkedA) - Date.parse(checkedB)
    if (checkedDelta !== 0) return checkedDelta
  }
  if (a.published_at === null && b.published_at !== null) return 1
  if (a.published_at !== null && b.published_at === null) return -1
  if (a.published_at && b.published_at) {
    const publishedDelta = Date.parse(b.published_at) - Date.parse(a.published_at)
    if (publishedDelta !== 0) return publishedDelta
  }
  const fetchedDelta = Date.parse(b.fetched_at) - Date.parse(a.fetched_at)
  return fetchedDelta || a.id.localeCompare(b.id)
}

function sourceRoundRobin(rows: Article[]): Article[] {
  const queues = new Map<string, Article[]>()
  for (const row of [...rows].sort(articleOrder)) {
    const key = sourceKey(row)
    const queue = queues.get(key) ?? []
    queue.push(row)
    queues.set(key, queue)
  }
  const keys = [...queues.keys()].sort()
  const result: Article[] = []
  while (keys.some((key) => (queues.get(key)?.length ?? 0) > 0)) {
    for (const key of keys) {
      const next = queues.get(key)?.shift()
      if (next) result.push(next)
    }
  }
  return result
}

function parseSuggestLog(): {
  events: LogEvent[]
  actualPoolIds: string[]
  suggestions: SavedSuggestion[]
} {
  const events = fs.readFileSync(SUGGEST_LOG, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as LogEvent)
  return {
    events,
    actualPoolIds: events
      .filter((event) => event.stage === 'entity_match')
      .map((event) => String(event.detail.article_id)),
    suggestions: events
      .filter((event) => event.stage === 'suggestion_saved')
      .map((event) => ({
        id: String(event.detail.id),
        topic: event.title ?? '',
        articleIds: (event.detail.article_ids ?? []).map(String),
      })),
  }
}

async function fetchAll(client: any, table: string, select: string): Promise<any[]> {
  const result: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(select).range(from, from + 999)
    if (error) throw new Error(`${table} SELECT failed: ${error.message}`)
    result.push(...(data ?? []))
    if ((data?.length ?? 0) < 1000) return result
  }
}

function latestRun(
  candidates: Article[],
  origin: 'rss' | 'correspondent',
): { runId: string; fetchedAtMin: string; fetchedAtMax: string; rows: Article[] } | null {
  const groups = new Map<string, Article[]>()
  for (const article of candidates) {
    if (article.origin !== origin || !article.ingestion_run_id) continue
    const group = groups.get(article.ingestion_run_id) ?? []
    group.push(article)
    groups.set(article.ingestion_run_id, group)
  }
  const runs = [...groups].map(([runId, rows]) => ({
    runId,
    fetchedAtMin: rows.map((row) => row.fetched_at).sort()[0],
    fetchedAtMax: rows.map((row) => row.fetched_at).sort().at(-1)!,
    rows,
  })).sort((a, b) => Date.parse(b.fetchedAtMax) - Date.parse(a.fetchedAtMax))
  return runs[0] ?? null
}

function freshSelection(
  preferred: Article[],
  correspondent: Article[],
  preferredTarget: number,
  correspondentTarget: number,
): Article[] {
  const preferredOrdered = sourceRoundRobin(preferred)
  const correspondentOrdered = sourceRoundRobin(correspondent)
  const selected = [
    ...preferredOrdered.slice(0, preferredTarget),
    ...correspondentOrdered.slice(0, correspondentTarget),
  ]
  const ids = new Set(selected.map(({ id }) => id))
  for (const row of preferredOrdered) {
    if (selected.length >= LIMIT) break
    if (!ids.has(row.id)) {
      selected.push(row)
      ids.add(row.id)
    }
  }
  for (const row of correspondentOrdered) {
    if (selected.length >= LIMIT) break
    if (!ids.has(row.id)) {
      selected.push(row)
      ids.add(row.id)
    }
  }
  return selected.slice(0, LIMIT)
}

function matcherMetrics(rows: Article[], dict: EntityEntry[]) {
  const {
    articleEntities,
    articleSupportingEntities,
  } = buildEntityIndex(rows, dict)
  const partition = partitionArticlesByEntityRole(
    rows,
    articleEntities,
    articleSupportingEntities,
  )
  const explicitFallback = partition.notMatched.filter(hasExplicitEdmEvidence)
  const eligible = selectEligibleLlmInput(partition, 120, 0.6)
  return {
    qualifying: partition.qualifying.length,
    danceExperience: partition.danceExperience.length,
    supportingOnly: partition.supportingOnly.length,
    notMatched: partition.notMatched.length,
    explicitFallback: explicitFallback.length,
    finalEligible: eligible.input.length,
  }
}

function policyMetrics(
  rows: Article[],
  dict: EntityEntry[],
  freshCorrespondentIds: Set<string>,
  suggestions: SavedSuggestion[],
  generated: GeneratedArticleLink[],
) {
  const ids = new Set(rows.map(({ id }) => id))
  const preferredCount = rows.filter((row) => row.ingestion_run_id === PREFERRED_RUN_ID).length
  const freshCorrespondentCount = rows.filter((row) => freshCorrespondentIds.has(row.id)).length
  const legacyCount = rows.filter((row) => originKey(row) === 'legacy').length
  const backlogCount = rows.length - preferredCount - freshCorrespondentCount - legacyCount
  const suggestionCoverage = suggestions.map((suggestion) => {
    const selectedCount = suggestion.articleIds.filter((id) => ids.has(id)).length
    return {
      id: suggestion.id,
      topic: suggestion.topic,
      articleIds: suggestion.articleIds,
      selectedCount,
      allSourcesIncluded: selectedCount === suggestion.articleIds.length,
    }
  })
  return {
    articleIds: rows.map(({ id }) => id),
    selected: rows.length,
    preferredRss: preferredCount,
    freshCorrespondent: freshCorrespondentCount,
    backlog: backlogCount,
    legacy: legacyCount,
    origin: Object.fromEntries(['rss', 'correspondent', 'legacy'].map((origin) => [
      origin,
      rows.filter((row) => originKey(row) === origin).length,
    ])),
    ...matcherMetrics(rows, dict),
    sourceDiversity: new Set(rows.map(sourceKey)).size,
    publishedAtNullShare: ratio(rows.filter((row) => !row.published_at).length, rows.length),
    productionSuggestionCoverage: {
      fullyIncluded: suggestionCoverage.filter((item) => item.allSourcesIncluded).length,
      anyIncluded: suggestionCoverage.filter((item) => item.selectedCount > 0).length,
      suggestions: suggestionCoverage,
    },
    generatedArticleCoverage: generated.map((article) => {
      const sourceIds = article.rawArticleIds
      return {
        articleId: article.id,
        articleTitle: article.title,
        suggestionId: article.suggestionId,
        suggestionTopic: article.suggestionTopic,
        rawArticleIds: sourceIds,
        selectedCount: sourceIds.filter((id) => ids.has(id)).length,
        allSourcesIncluded: sourceIds.length > 0 && sourceIds.every((id) => ids.has(id)),
      }
    }),
  }
}

function ageBucket(article: Article, at: number): '0-7d' | '8-30d' | '31-90d' | '91d+' {
  const days = Math.max(0, (at - Date.parse(article.fetched_at)) / 86_400_000)
  if (days <= 7) return '0-7d'
  if (days <= 30) return '8-30d'
  if (days <= 90) return '31-90d'
  return '91d+'
}

function roundRobinQueues(queues: Map<string, Article[]>): Article[] {
  const keys = [...queues.keys()].sort()
  const result: Article[] = []
  while (keys.some((key) => (queues.get(key)?.length ?? 0) > 0)) {
    for (const key of keys) {
      const next = queues.get(key)?.shift()
      if (next) result.push(next)
    }
  }
  return result
}

function uncheckedSourceRoundRobin(rows: Article[]): Article[] {
  const orderedOrigin = (subset: Article[]) => {
    const queues = new Map<string, Article[]>()
    for (const origin of ['rss', 'correspondent', 'legacy'] as const) {
      queues.set(origin, sourceRoundRobin(subset.filter((row) => originKey(row) === origin)))
    }
    return roundRobinQueues(queues)
  }
  return [
    ...orderedOrigin(rows.filter((row) => !row.suggestion_last_checked_at)),
    ...orderedOrigin(rows.filter((row) => Boolean(row.suggestion_last_checked_at))),
  ]
}

function flatSourceRoundRobin(rows: Article[]): Article[] {
  const queues = new Map<string, Article[]>()
  for (const row of [...rows].sort(articleOrder)) {
    const key = `${originKey(row)}:${sourceKey(row)}`
    const queue = queues.get(key) ?? []
    queue.push(row)
    queues.set(key, queue)
  }
  return roundRobinQueues(queues)
}

function ageBucketRoundRobin(rows: Article[], at: number): Article[] {
  const queues = new Map<string, Article[]>()
  for (const bucket of ['0-7d', '8-30d', '31-90d', '91d+']) {
    queues.set(bucket, rows.filter((row) => ageBucket(row, at) === bucket).sort(articleOrder))
  }
  return roundRobinQueues(queues)
}

function combinedFairQueue(rows: Article[], at: number): Article[] {
  const orderGroup = (subset: Article[]) => {
    const queues = new Map<string, Article[]>()
    for (const origin of ['rss', 'correspondent', 'legacy'] as const) {
      for (const bucket of ['0-7d', '8-30d', '31-90d', '91d+'] as const) {
        const rowsForQueue = subset.filter((row) =>
          originKey(row) === origin && ageBucket(row, at) === bucket
        )
        queues.set(`${origin}:${bucket}`, flatSourceRoundRobin(rowsForQueue))
      }
    }
    return roundRobinQueues(queues)
  }
  return [
    ...orderGroup(rows.filter((row) => !row.suggestion_last_checked_at)),
    ...orderGroup(rows.filter((row) => Boolean(row.suggestion_last_checked_at))),
  ]
}

function selectionSummary(rows: Article[], dict: EntityEntry[], at: number) {
  const { articleEntities, entityArticles } = buildEntityIndex(rows, dict)
  const groups = buildPairClusters(rows, articleEntities, entityArticles, dict)
    .sort((a, b) => b.weightSum - a.weightSum)
  return {
    articleIds: rows.map(({ id }) => id),
    origin: Object.fromEntries(['rss', 'correspondent', 'legacy'].map((origin) => [
      origin,
      rows.filter((row) => originKey(row) === origin).length,
    ])),
    sourceDiversity: new Set(rows.map(sourceKey)).size,
    unchecked: rows.filter((row) => !row.suggestion_last_checked_at).length,
    ageBuckets: Object.fromEntries(['0-7d', '8-30d', '31-90d', '91d+'].map((bucket) => [
      bucket,
      rows.filter((row) => ageBucket(row, at) === bucket).length,
    ])),
    pairGroupCount: groups.length,
    pairArticleCount: new Set(groups.flatMap((group) => group.articleIds)).size,
  }
}

function capLoss(
  rows: Article[],
  entityArticles: Map<string, Set<string>>,
  dict: EntityEntry[],
) {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const qualifying = new Set(
    dict.filter((entry) => entry.role !== 'supporting').map((entry) => entry.canonical),
  )
  const dropped = new Set<string>()
  let memberships = 0
  const entities: Array<{ entity: string; before: number; dropped: number }> = []
  for (const [entity, idsValue] of entityArticles) {
    if (!qualifying.has(entity) || idsValue.size <= 15) continue
    const ids = [...idsValue].sort((a, b) => {
      const pa = byId.get(a)?.published_at ?? ''
      const pb = byId.get(b)?.published_at ?? ''
      return pb.localeCompare(pa)
    })
    const tail = ids.slice(15)
    memberships += tail.length
    tail.forEach((id) => dropped.add(id))
    entities.push({ entity, before: ids.length, dropped: tail.length })
  }
  return {
    uniqueArticleCount: dropped.size,
    membershipCount: memberships,
    entities: entities.sort((a, b) => b.dropped - a.dropped),
  }
}

function markdown1(output: any): string {
  const rows = FRESHNESS_HOURS.flatMap((hours) =>
    Object.entries(output.freshness[String(hours)].policies).map(([name, metric]: [string, any]) =>
      `| ${hours}h | ${name} | ${metric.preferredRss}/${metric.freshCorrespondent}/${metric.backlog}/${metric.legacy} | ${metric.qualifying}/${metric.supportingOnly}/${metric.notMatched} | ${metric.explicitFallback}/${metric.finalEligible} | ${metric.sourceDiversity} | ${metric.publishedAtNullShare} | ${metric.productionSuggestionCoverage.fullyIncluded}/30 | ${metric.generatedArticleCoverage.filter((item: any) => item.allSourcesIncluded).length}/${metric.generatedArticleCoverage.length} |`
    )
  )
  return `# Suggest 1 fresh policy audit — 2026-08-08

## Scope

- SELECT-only production snapshot.
- Reference state: immediately before the production Suggest run at ${REFERENCE_AT}.
- Preferred RSS ingestion run: \`${PREFERRED_RUN_ID}\`.
- LLM was not re-run. Production matcher and eligibility functions were imported.
- Exact article IDs and per-suggestion/per-generated-article coverage are in the JSON.

## Result

| Freshness | Policy | Preferred/Fresh corr/Backlog/Legacy | Qual/Supporting/Not | Explicit/Eligible | Sources | Null share | Suggestions | Generated |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}

Latest explicit correspondent ingestion cohort: ${output.latestCorrespondentRun?.runId ?? 'none'}. The 24h/72h/7d windows therefore ${output.latestCorrespondentRun ? 'use the age shown in JSON' : 'have no explicit correspondent cohort to admit'}.

The five generated articles are the latest five production articles linked through suggestion clusters. ${output.productionSuggestionGeneratedArticleCount} belong to this 30-suggestion run; the remainder belongs to an earlier suggestion. Coverage is measured from each linked suggestion's raw article IDs.

## Recommendation

${output.recommendation}
`
}

function markdown2(output: any): string {
  const policyRows = Object.entries(output.selectionPolicies).flatMap(([policy, budgets]: [string, any]) =>
    BACKLOG_BUDGETS.map((budget) => {
      const value = budgets[String(budget)]
      return `| ${policy} | ${budget} | ${value.origin.rss}/${value.origin.correspondent}/${value.origin.legacy} | ${value.sourceDiversity} | ${value.unchecked} | ${value.ageBuckets['0-7d']}/${value.ageBuckets['8-30d']}/${value.ageBuckets['31-90d']}/${value.ageBuckets['91d+']} | ${value.pairGroupCount}/${value.pairArticleCount} |`
    })
  )
  return `# Suggest 2 backlog audit — 2026-08-08

## Scope

- SELECT-only production snapshot generated at ${output.generatedAt}.
- Backlog means currently eligible raw articles excluding the preferred RSS run and any explicit fresh correspondent run admitted by the recommended freshness window.
- Existing \`/api/suggest-clusters/extended\` query semantics and production \`buildPairClusters\` were reproduced. LLM was not called.
- Legacy means rows whose origin is neither \`rss\` nor \`correspondent\`, including historical null-origin rows.
- No article content is persisted in this report. Exact selection IDs and group IDs are in the JSON.

## Existing extended-route baseline

- Eligible rows before fresh-cohort exclusion: ${output.existingExtendedBaseline.eligibleRows}
- Pair groups/articles: ${output.existingExtendedBaseline.groupCount}/${output.existingExtendedBaseline.articleCount}
- Top-30 group IDs are recorded in JSON.

## Backlog

- Total: ${output.backlog.total}
- Origin RSS/correspondent/legacy: ${output.backlog.origin.rss}/${output.backlog.origin.correspondent}/${output.backlog.origin.legacy}
- Age 0–7/8–30/31–90/91+ days: ${output.backlog.ageBuckets['0-7d']}/${output.backlog.ageBuckets['8-30d']}/${output.backlog.ageBuckets['31-90d']}/${output.backlog.ageBuckets['91d+']}
- Checked null/present: ${output.backlog.checked.null}/${output.backlog.checked.present}
- Qualifying/supporting/not-matched: ${output.backlog.qualifying}/${output.backlog.supportingOnly}/${output.backlog.notMatched}
- Pair groups/articles: ${output.backlog.pairClusters.groupCount}/${output.backlog.pairClusters.articleCount}
- Qualifying singleton-only: ${output.backlog.singletonOnly.count}
- Entity cap loss: ${output.backlog.entityCapLoss.uniqueArticleCount} unique articles (${output.backlog.entityCapLoss.membershipCount} memberships)
- Top-30 displaced groups: ${output.backlog.top30.displacedGroupCount}
- Unchanged-input deterministic repeat: ${output.backlog.top30.repeatableTopGroupCount}/${output.backlog.top30.selectedGroupCount}

## Bounded selector comparison

| Policy | Budget | RSS/Corr/Legacy | Sources | Unchecked | Age buckets | Pair groups/articles |
|---|---:|---:|---:|---:|---:|---:|
${policyRows.join('\n')}

## Recommendation

${output.recommendation}
`
}

async function main() {
  const client = createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const [{ events, actualPoolIds, suggestions }, rawRows, sources, suggestionRows, articleRows] =
    await Promise.all([
      Promise.resolve(parseSuggestLog()),
      fetchAll(
        client,
        'raw_articles',
        'id,title,content,url,source_id,published_at,fetched_at,event_date,suggestion_state,suggestion_last_checked_at,suggestion_rejected_at,suggestion_used_at,facts,origin,ingestion_run_id,ingestion_source',
      ),
      fetchAll(client, 'rss_sources', 'id,name'),
      fetchAll(client, 'suggested_clusters', 'id,topic,article_ids,status,cluster_id,created_at'),
      fetchAll(client, 'articles', 'id,title,cluster_id,created_at,published'),
    ])
  const sourceNames = new Map(sources.map((source) => [String(source.id), source.name]))
  const articles: Article[] = rawRows.map((row) => ({
    ...row,
    sourceName: row.source_id === null ? undefined : sourceNames.get(String(row.source_id)),
  }))
  const byId = new Map(articles.map((article) => [article.id, article]))
  const dict = loadEntityDictionary()

  if (actualPoolIds.length !== 100) {
    throw new Error(`expected 100 production pool IDs, got ${actualPoolIds.length}`)
  }
  if (suggestions.length !== 30) {
    throw new Error(`expected 30 saved production suggestions, got ${suggestions.length}`)
  }
  const persistedById = new Map(suggestionRows.map((row) => [row.id, row]))
  for (const suggestion of suggestions) {
    const persisted = persistedById.get(suggestion.id)
    suggestion.status = persisted?.status ?? null
    suggestion.clusterId = persisted?.cluster_id ?? null
  }
  const suggestionByCluster = new Map(
    suggestionRows.filter((row) => row.cluster_id).map((row) => [row.cluster_id, row]),
  )
  const generated: GeneratedArticleLink[] = [...articleRows]
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 5)
    .map((article) => {
      const suggestion = article.cluster_id
        ? suggestionByCluster.get(article.cluster_id)
        : undefined
      return {
        id: article.id,
        title: article.title,
        clusterId: article.cluster_id,
        suggestionId: suggestion?.id ?? null,
        suggestionTopic: suggestion?.topic ?? null,
        rawArticleIds: (suggestion?.article_ids ?? []).map(String),
      }
    })

  const referenceCandidates = articles.filter((article) => stateAt(article, REFERENCE_AT) === 'eligible')
  const preferredReference = referenceCandidates.filter(
    (article) => article.ingestion_run_id === PREFERRED_RUN_ID,
  )
  const latestCorrespondentReference = latestRun(referenceCandidates, 'correspondent')
  const actualPool = actualPoolIds
    .map((id) => byId.get(id))
    .filter((article): article is Article => Boolean(article))
  const freshness: Record<string, any> = {}
  for (const hours of FRESHNESS_HOURS) {
    const correspondentFresh = latestCorrespondentReference
      && Date.parse(REFERENCE_AT) - Date.parse(latestCorrespondentReference.fetchedAtMax)
        <= hours * 3_600_000
      ? latestCorrespondentReference.rows
      : []
    const correspondentIds = new Set(correspondentFresh.map(({ id }) => id))
    const policies = {
      Current: actualPool,
      'Fresh-70/30': freshSelection(preferredReference, correspondentFresh, 70, 30),
      'Fresh-80/20': freshSelection(preferredReference, correspondentFresh, 80, 20),
      'Preferred-first': freshSelection(preferredReference, correspondentFresh, 100, 0),
    }
    freshness[String(hours)] = {
      correspondentFresh: correspondentFresh.length > 0,
      policies: Object.fromEntries(Object.entries(policies).map(([name, rows]) => [
        name,
        policyMetrics(rows, dict, correspondentIds, suggestions, generated),
      ])),
    }
  }
  const poolDetail = events.find((event) => event.stage === 'pool_query')?.detail ?? {}
  const output1 = {
    generatedAt: new Date().toISOString(),
    referenceAt: REFERENCE_AT,
    preferredRunId: PREFERRED_RUN_ID,
    preferredReferenceEligibleCount: preferredReference.length,
    latestCorrespondentRun: latestCorrespondentReference
      ? {
        runId: latestCorrespondentReference.runId,
        fetchedAtMin: latestCorrespondentReference.fetchedAtMin,
        fetchedAtMax: latestCorrespondentReference.fetchedAtMax,
        ageHoursAtReference: Number((
          (Date.parse(REFERENCE_AT) - Date.parse(latestCorrespondentReference.fetchedAtMax)) / 3_600_000
        ).toFixed(2)),
        eligibleRows: latestCorrespondentReference.rows.length,
      }
      : null,
    actualProductionDiagnostics: poolDetail,
    productionSuggestionCount: suggestions.length,
    productionSuggestionGeneratedArticleCount: generated.filter((article) =>
      suggestions.some((suggestion) => suggestion.id === article.suggestionId)
    ).length,
    generatedArticleCount: generated.length,
    freshness,
    recommendation:
      'Keep a 70% preferred RSS entitlement and reserve up to 30% for a correspondent cohort no older than 72 hours. This dataset has no explicit correspondent cohort in any tested window, and filling the missing correspondent quota only from preferred RSS reduces coverage of the 30 production suggestions and five generated articles; therefore fall the unused share back to the existing fair remainder rather than preferred-only refill. If no preferred run exists, resolve the latest eligible explicit ingestion run and retain cohort_fair_v1.',
  }
  fs.writeFileSync(OUTPUT1_JSON, `${JSON.stringify(output1, null, 2)}\n`)
  fs.writeFileSync(OUTPUT1_MD, markdown1(output1))

  const now = Date.now()
  const currentEligible = articles.filter((article) =>
    article.suggestion_state === null || article.suggestion_state === 'new'
  )
  const latestCorrespondentCurrent = latestRun(currentEligible, 'correspondent')
  const currentIndex = buildEntityIndex(currentEligible, dict)
  const currentGroups = buildPairClusters(
    currentEligible,
    currentIndex.articleEntities,
    currentIndex.entityArticles,
    dict,
  ).sort((a, b) => b.weightSum - a.weightSum)
  const admittedCorrespondentIds = new Set(
    latestCorrespondentCurrent
      && now - Date.parse(latestCorrespondentCurrent.fetchedAtMax) <= 72 * 3_600_000
      ? latestCorrespondentCurrent.rows.map(({ id }) => id)
      : [],
  )
  const freshIds = new Set(currentEligible.filter((article) =>
    article.ingestion_run_id === PREFERRED_RUN_ID || admittedCorrespondentIds.has(article.id)
  ).map(({ id }) => id))
  const backlog = currentEligible.filter((article) => !freshIds.has(article.id))
  const {
    articleEntities,
    articleSupportingEntities,
    entityArticles,
  } = buildEntityIndex(backlog, dict)
  const partition = partitionArticlesByEntityRole(backlog, articleEntities, articleSupportingEntities)
  const groups = buildPairClusters(backlog, articleEntities, entityArticles, dict)
    .sort((a, b) => b.weightSum - a.weightSum)
  const pairArticleIds = new Set(groups.flatMap((group) => group.articleIds))
  const top30 = groups.slice(0, 30)
  const repeated = buildPairClusters(backlog, articleEntities, entityArticles, dict)
    .sort((a, b) => b.weightSum - a.weightSum)
    .slice(0, 30)
  const signature = (group: { entity: string; articleIds: string[] }) =>
    `${group.entity}:${[...group.articleIds].sort().join(',')}`
  const repeatedSignatures = new Set(repeated.map(signature))
  const selectorOrders = {
    unchecked_source_round_robin: uncheckedSourceRoundRobin(backlog),
    age_bucket_round_robin: ageBucketRoundRobin(backlog, now),
    origin_source_age_fair_queue: combinedFairQueue(backlog, now),
  }
  const output2 = {
    generatedAt: new Date(now).toISOString(),
    preferredRunId: PREFERRED_RUN_ID,
    freshDefinition: {
      preferredEligibleRows: currentEligible.filter(
        (article) => article.ingestion_run_id === PREFERRED_RUN_ID,
      ).length,
      correspondentFreshnessHours: 72,
      latestCorrespondentRun: latestCorrespondentCurrent?.runId ?? null,
      admittedCorrespondentRows: admittedCorrespondentIds.size,
    },
    existingExtendedBaseline: {
      eligibleRows: currentEligible.length,
      groupCount: currentGroups.length,
      articleCount: new Set(currentGroups.flatMap((group) => group.articleIds)).size,
      top30: currentGroups.slice(0, 30),
    },
    backlog: {
      total: backlog.length,
      articleIds: backlog.map(({ id }) => id),
      origin: Object.fromEntries(['rss', 'correspondent', 'legacy'].map((origin) => [
        origin,
        backlog.filter((row) => originKey(row) === origin).length,
      ])),
      ageBuckets: Object.fromEntries(['0-7d', '8-30d', '31-90d', '91d+'].map((bucket) => [
        bucket,
        backlog.filter((row) => ageBucket(row, now) === bucket).length,
      ])),
      checked: {
        null: backlog.filter((row) => !row.suggestion_last_checked_at).length,
        present: backlog.filter((row) => Boolean(row.suggestion_last_checked_at)).length,
      },
      qualifying: partition.qualifying.length,
      danceExperience: partition.danceExperience.length,
      supportingOnly: partition.supportingOnly.length,
      notMatched: partition.notMatched.length,
      explicitFallback: partition.notMatched.filter(hasExplicitEdmEvidence).length,
      pairClusters: {
        groupCount: groups.length,
        articleCount: pairArticleIds.size,
        groups,
      },
      singletonOnly: {
        count: partition.qualifying.filter((article) => !pairArticleIds.has(article.id)).length,
        articleIds: partition.qualifying
          .filter((article) => !pairArticleIds.has(article.id))
          .map(({ id }) => id),
      },
      entityCapLoss: capLoss(backlog, entityArticles, dict),
      top30: {
        selectedGroupCount: top30.length,
        displacedGroupCount: Math.max(0, groups.length - top30.length),
        groups: top30,
        repeatableTopGroupCount: top30.filter((group) => repeatedSignatures.has(signature(group))).length,
        repeatProbabilityOnUnchangedInput: top30.length === 0 ? 0 : 1,
      },
    },
    selectionPolicies: Object.fromEntries(Object.entries(selectorOrders).map(([name, order]) => [
      name,
      Object.fromEntries(BACKLOG_BUDGETS.map((budget) => [
        String(budget),
        selectionSummary(order.slice(0, budget), dict, now),
      ])),
    ])),
    recommendation:
      'Keep the existing Suggest 2 route, UI name, and pair-clustering concept. Define its backlog as currently eligible rows outside admitted fresh cohorts. Use an origin/source/age fair queue with unchecked rows first, persist a cursor or checked timestamp only for groups actually submitted to the Suggest 2 LLM, and retain qualifying singleton backlog for later passes rather than sending singleton-only items through the pair-cluster LLM.',
  }
  fs.writeFileSync(OUTPUT2_JSON, `${JSON.stringify(output2, null, 2)}\n`)
  fs.writeFileSync(OUTPUT2_MD, markdown2(output2))
  console.log(JSON.stringify({
    suggest1: {
      preferredReferenceEligibleCount: output1.preferredReferenceEligibleCount,
      latestCorrespondentRun: output1.latestCorrespondentRun,
      generatedArticleCount: generated.length,
    },
    suggest2: {
      backlog: output2.backlog.total,
      pairGroups: output2.backlog.pairClusters.groupCount,
      singletonOnly: output2.backlog.singletonOnly.count,
    },
  }, null, 2))
}

void main()
