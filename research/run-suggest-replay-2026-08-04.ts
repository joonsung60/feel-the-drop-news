/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import Module from 'node:module'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import type { RawArticle, Suggestion, SuggestionWithArticles } from '../lib/suggest/types'

const BATCH_START = '2026-08-04T08:46:35Z'
const BATCH_END = '2026-08-04T08:49:30Z'
const EXPECTED_POOL = 123
const LLM_INPUT_MAX = 120
const NO_ENTITY_RATIO_MAX = 0.6
const LLM_BATCH_SIZE = 20
const EXCERPT_LIMIT = 800
const RUN_ID = process.env.SUGGEST_REPLAY_RUN_ID?.replace(/[^a-zA-Z0-9_-]/g, '') || ''
const OUTPUT_STEM = RUN_ID
  ? `suggest-replay-2026-08-04-${RUN_ID}`
  : 'suggest-replay-2026-08-04'
const OUTPUT_JSON = path.join(process.cwd(), `research/${OUTPUT_STEM}.json`)
const OUTPUT_MD = path.join(process.cwd(), `research/${OUTPUT_STEM}.md`)

// Compiled CommonJS research runners do not understand tsconfig's @/* mapping.
// Install the same mapping before loading production modules dynamically.
const moduleInternals = Module as any
const originalResolveFilename = moduleInternals._resolveFilename
const aliasRoot = process.env.SUGGEST_REPLAY_MODULE_ROOT || process.cwd()
moduleInternals._resolveFilename = function (
  request: string,
  parent: unknown,
  isMain: boolean,
  options: unknown,
) {
  const mapped = request.startsWith('@/')
    ? path.join(aliasRoot, request.slice(2))
    : request
  return originalResolveFilename.call(this, mapped, parent, isMain, options)
}

const {
  buildEntityIndex,
  loadEntityDictionary,
} = require('../lib/suggest/entity-index') as typeof import('../lib/suggest/entity-index')
const {
  correspondentApprovalPath,
  hasExplicitEdmEvidence,
  partitionArticlesByEntityRole,
  selectEligibleLlmInput,
} = require('../lib/suggest/eligibility') as typeof import('../lib/suggest/eligibility')
const {
  chunkArticles,
  isSingletonRawSuggestion,
  normalizeSuggestion,
  parseSuggestions,
  normalizeTopicKey,
} = require('../lib/suggest/normalize') as typeof import('../lib/suggest/normalize')
const {
  SUGGEST_RESPONSE_FORMAT,
  SUGGEST_SYSTEM,
  buildClusterPrompt,
} = require('../lib/suggest/prompts') as typeof import('../lib/suggest/prompts')
const {
  mergeNormalizedSuggestions,
} = require('../lib/suggest/merge') as typeof import('../lib/suggest/merge')
const { rankAndTrim } = require('../lib/suggest/rank') as typeof import('../lib/suggest/rank')
const {
  filterDuplicateSuggestions,
} = require('../lib/suggest/filters') as typeof import('../lib/suggest/filters')
const { attachSourceMeta } = require('../lib/suggest/db') as typeof import('../lib/suggest/db')
const {
  hasEventDateConflict,
  knownEventDates,
} = require('../lib/suggest/event-date') as typeof import('../lib/suggest/event-date')

type ReplayArticle = RawArticle & {
  origin: string | null
  fetched_at: string
}

type Drop = {
  stage: string
  reason: string
  articleIds: string[]
  topic?: string | null
  detail?: Record<string, unknown>
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} environment variable is required`)
  return value
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function excerpt(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LIMIT)
}

function suggestionView(suggestion: Partial<Suggestion>) {
  return {
    topic: suggestion.topic ?? null,
    keywords: suggestion.keywords ?? [],
    articleIds: suggestion.articleIds ?? [],
    reason: suggestion.reason ?? null,
    commonEntities: suggestion.commonEntities ?? [],
    cohesionScore: suggestion.cohesionScore ?? null,
  }
}

async function exactCount(
  supabase: any,
  table: string,
  configure?: (query: any) => any,
): Promise<number> {
  let query = supabase.from(table).select('*', { count: 'exact', head: true })
  if (configure) query = configure(query)
  const { count, error } = await query
  if (error) throw new Error(`${table} count failed: ${error.message}`)
  if (typeof count !== 'number') throw new Error(`${table} count unavailable`)
  return count
}

async function databaseSnapshot(supabase: any) {
  const statuses = ['pending', 'rejected', 'published']
  const suggestedByStatus = Object.fromEntries(await Promise.all(
    statuses.map(async (status) => [
      status,
      await exactCount(supabase, 'suggested_clusters', (query) => query.eq('status', status)),
    ]),
  ))
  const rawStateRows = await Promise.all(
    ['new', 'suggested', 'rejected'].map(async (state) => [
      state,
      await exactCount(supabase, 'raw_articles', (query) => query.eq('suggestion_state', state)),
    ]),
  )
  const rawNull = await exactCount(
    supabase,
    'raw_articles',
    (query) => query.is('suggestion_state', null),
  )
  return {
    raw_articles_total: await exactCount(supabase, 'raw_articles'),
    suggested_clusters_total: await exactCount(supabase, 'suggested_clusters'),
    suggested_clusters_by_status: suggestedByStatus,
    raw_articles_suggestion_state: {
      null: rawNull,
      ...Object.fromEntries(rawStateRows),
    },
  }
}

function sameSnapshot(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function partitionName(
  id: string,
  partition: ReturnType<typeof partitionArticlesByEntityRole>,
): string {
  if (partition.qualifying.some((article) => article.id === id)) return 'qualifying'
  if (partition.danceExperience.some((article) => article.id === id)) return 'danceExperience'
  if (partition.supportingOnly.some((article) => article.id === id)) return 'supportingOnly'
  return 'notMatched'
}

async function loadDuplicateProvenance(supabase: any) {
  const { data: suggestions, error: suggestionError } = await supabase
    .from('suggested_clusters')
    .select('topic, status')
    .in('status', ['pending', 'rejected', 'published'])
  if (suggestionError) throw new Error(`suggested duplicate provenance failed: ${suggestionError.message}`)

  const byTopic = new Map<string, Set<string>>()
  for (const row of suggestions ?? []) {
    if (!row.topic) continue
    const key = normalizeTopicKey(row.topic)
    if (!byTopic.has(key)) byTopic.set(key, new Set())
    byTopic.get(key)!.add(`suggested_clusters:${row.status}`)
  }

  const { data: publishedArticles, error: publishedError } = await supabase
    .from('articles')
    .select('cluster_id')
    .eq('published', true)
    .not('cluster_id', 'is', null)
  if (publishedError) throw new Error(`published article cluster lookup failed: ${publishedError.message}`)
  const clusterIds = Array.from(new Set(
    (publishedArticles ?? []).map((row: any) => row.cluster_id).filter(Boolean),
  ))
  if (clusterIds.length > 0) {
    const { data: clusters, error: clusterError } = await supabase
      .from('article_clusters')
      .select('topic')
      .in('id', clusterIds)
    if (clusterError) throw new Error(`published topic lookup failed: ${clusterError.message}`)
    for (const row of clusters ?? []) {
      if (!row.topic) continue
      const key = normalizeTopicKey(row.topic)
      if (!byTopic.has(key)) byTopic.set(key, new Set())
      byTopic.get(key)!.add('published_articles:article_clusters')
    }
  }
  return byTopic
}

function renderMarkdown(result: any): string {
  const f = result.funnel
  const lines = [
    '# Production suggest replay — 2026-08-04',
    '',
    `- 실행 시각: ${result.run.finishedAt}`,
    `- 모델: \`${result.run.model}\``,
    `- batch: \`${BATCH_START}\` ~ \`${BATCH_END}\``,
    `- DB 변경 없음: **${result.database.unchanged ? '확인' : '실패'}**`,
    '',
    '## Funnel',
    '',
    '| 단계 | 건수 |',
    '|---|---:|',
    `| exact pool | ${f.exactPool} |`,
    `| qualifying | ${f.qualifying} |`,
    `| danceExperience | ${f.danceExperience} |`,
    `| supportingOnly | ${f.supportingOnly} |`,
    `| notMatched | ${f.notMatched} |`,
    `| explicit fallback | ${f.explicitFallback} |`,
    `| final eligible | ${f.finalEligible} |`,
    `| LLM raw suggestions | ${f.llmRawSuggestions} |`,
    `| raw multi-article suggestions | ${f.rawMultiArticleSuggestions} |`,
    `| normalized | ${f.normalized} |`,
    `| merged | ${f.merged} |`,
    `| ranked | ${f.ranked} |`,
    `| duplicate/blocklist 탈락 | ${f.duplicateOrBlocked} |`,
    `| saveable | ${f.saveable} |`,
    '',
    '## Saveable suggestions',
    '',
  ]
  if (result.saveableSuggestions.length === 0) {
    lines.push('- 없음')
  } else {
    for (const item of result.saveableSuggestions) {
      lines.push(`### ${item.topic}`, '')
      lines.push(`- entities: ${item.commonEntities.join(', ') || '(없음)'}`)
      lines.push(`- article IDs: ${item.articleIds.join(', ')}`)
      for (const article of item.articles) {
        lines.push(`  - ${article.id}: ${article.title}`)
      }
      lines.push('')
    }
  }
  lines.push('## LLM omissions', '')
  if (result.llmOmittedArticles.length === 0) {
    lines.push('- 없음')
  } else {
    for (const article of result.llmOmittedArticles) {
      lines.push(`- ${article.id}: ${article.title}`)
    }
  }
  lines.push('')
  lines.push('## Drops', '')
  for (const drop of result.drops) {
    lines.push(`- \`${drop.stage}/${drop.reason}\` — ${drop.topic ?? '(article gate)'} — ${drop.articleIds.join(', ') || '(none)'}`)
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  const startedAt = new Date().toISOString()
  const supabase = createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  const model = process.env.OLLAMA_SUGGEST_MODEL || process.env.OLLAMA_MODEL || 'qwen3:14b'
  const before = await databaseSnapshot(supabase)

  const { data, error } = await supabase
    .from('raw_articles')
    .select('id, title, content, url, source_id, published_at, event_date, facts, origin, fetched_at')
    .gte('fetched_at', BATCH_START)
    .lte('fetched_at', BATCH_END)
    .order('published_at', { ascending: false })
  if (error) throw new Error(`exact pool query failed: ${error.message}`)
  if ((data?.length ?? 0) !== EXPECTED_POOL) {
    throw new Error(`exact pool mismatch: expected ${EXPECTED_POOL}, got ${data?.length ?? 0}`)
  }

  const rawArticles = await attachSourceMeta(data as ReplayArticle[]) as ReplayArticle[]
  const articleMeta = new Map(rawArticles.map((article) => [
    article.id,
    { id: article.id, title: article.title, url: article.url },
  ]))
  const dict = loadEntityDictionary()
  const index = buildEntityIndex(rawArticles, dict)
  const partition = partitionArticlesByEntityRole(
    rawArticles,
    index.articleEntities,
    index.articleSupportingEntities,
  )
  const selected = selectEligibleLlmInput(partition, LLM_INPUT_MAX, NO_ENTITY_RATIO_MAX)
  const eligibleIds = new Set(selected.input.map((article) => article.id))
  const fallbackIds = new Set(selected.noEntitySelected.map((article) => article.id))
  const drops: Drop[] = []
  for (const article of rawArticles) {
    if (eligibleIds.has(article.id)) continue
    const part = partitionName(article.id, partition)
    const reason = part === 'supportingOnly'
      ? 'supporting_entity_only'
      : part === 'notMatched' && !hasExplicitEdmEvidence(article)
        ? 'no_entity_or_explicit_edm_evidence'
        : part === 'notMatched'
          ? 'non_entity_cap'
          : 'entity_cap'
    drops.push({ stage: 'eligibility', reason, articleIds: [article.id] })
  }

  const batches = chunkArticles(selected.input, LLM_BATCH_SIZE)
  const rawLlm: any[] = []
  const normalized: SuggestionWithArticles[] = []
  for (const [batchIndex, batch] of batches.entries()) {
    const validIds = new Set(batch.map((article) => article.id))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 180000)
    let response: Response
    try {
      response = await fetch(`${ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          options: { num_ctx: 16384 },
          system: SUGGEST_SYSTEM,
          prompt: buildClusterPrompt(batch),
          format: SUGGEST_RESPONSE_FORMAT,
          stream: false,
        }),
        signal: controller.signal,
      })
    } catch (error) {
      clearTimeout(timeout)
      drops.push({
        stage: 'llm',
        reason: error instanceof Error && error.name === 'AbortError' ? 'llm_timeout' : 'llm_fetch_error',
        articleIds: batch.map((article) => article.id),
        detail: { error: String(error) },
      })
      continue
    }
    clearTimeout(timeout)
    if (!response.ok) {
      drops.push({
        stage: 'llm',
        reason: 'llm_http_error',
        articleIds: batch.map((article) => article.id),
        detail: { status: response.status },
      })
      continue
    }
    const payload = await response.json() as { response?: string }
    const responseText = payload.response ?? ''
    let parsed: { suggestions?: Suggestion[] }
    try {
      parsed = parseSuggestions(responseText)
    } catch (error) {
      rawLlm.push({
        batchIndex,
        articleIds: batch.map((article) => article.id),
        responseExcerpt: excerpt(responseText),
        responseLength: responseText.length,
        responseHash: hash(responseText),
        parseError: String(error),
        suggestions: [],
      })
      drops.push({
        stage: 'llm',
        reason: 'llm_parse_error',
        articleIds: batch.map((article) => article.id),
        detail: { error: String(error) },
      })
      continue
    }
    const suggestions = parsed.suggestions ?? []
    rawLlm.push({
      batchIndex,
      articleIds: batch.map((article) => article.id),
      responseExcerpt: excerpt(responseText),
      responseLength: responseText.length,
      responseHash: hash(responseText),
      suggestions: suggestions.map(suggestionView),
    })
    for (const suggestion of suggestions) {
      if (!isSingletonRawSuggestion(suggestion)) {
        drops.push({
          stage: 'llm',
          reason: 'raw_multi_article_not_allowed',
          articleIds: Array.isArray(suggestion.articleIds)
            ? suggestion.articleIds.map(String)
            : [],
          topic: suggestion.topic ?? null,
        })
        continue
      }
      const item = normalizeSuggestion(
        suggestion,
        validIds,
        articleMeta,
        rawArticles,
        index.articleEntities,
      )
      if (item) {
        normalized.push(item)
      } else {
        const requested = (Array.isArray(suggestion.articleIds) ? suggestion.articleIds : [])
          .map((id) => String(id).trim())
        const valid = requested.filter((id) => validIds.has(id))
        drops.push({
          stage: 'normalization',
          reason: requested.some((id) => !validIds.has(id))
            ? 'article_not_edm_eligible'
            : hasEventDateConflict(valid, rawArticles)
              ? 'event_date_conflict'
              : 'normalization_failed',
          articleIds: requested,
          topic: suggestion.topic ?? null,
          detail: {
            validArticleIds: valid,
            eventDates: knownEventDates(valid, rawArticles),
          },
        })
      }
    }
  }

  const merged = mergeNormalizedSuggestions(normalized, rawArticles)
  const mergedSet = new Set(merged)
  for (const suggestion of normalized) {
    if (!mergedSet.has(suggestion)) {
      drops.push({
        stage: 'merge',
        reason: 'merged_into_suggestion',
        articleIds: suggestion.articleIds,
        topic: suggestion.topic,
      })
    }
  }
  const ranked = rankAndTrim(merged, rawArticles, dict)
  const rankedSet = new Set(ranked)
  for (const suggestion of merged) {
    if (!rankedSet.has(suggestion)) {
      drops.push({
        stage: 'ranking',
        reason: 'rank_cap',
        articleIds: suggestion.articleIds,
        topic: suggestion.topic,
      })
    }
  }

  const duplicateProvenance = await loadDuplicateProvenance(supabase)
  const duplicateDetails: any[] = []
  const filtered = await filterDuplicateSuggestions(ranked, (suggestion, reason) => {
    const provenance = [...(duplicateProvenance.get(normalizeTopicKey(suggestion.topic)) ?? [])]
    duplicateDetails.push({
      ...suggestionView(suggestion),
      reason,
      provenance,
    })
    drops.push({
      stage: 'duplicate_filter',
      reason,
      articleIds: suggestion.articleIds,
      topic: suggestion.topic,
      detail: { provenance },
    })
  })

  const articleOutput = rawArticles.map((article) => {
    const content = article.content ?? ''
    const entities = [...(index.articleEntities.get(article.id) ?? [])]
    const supporting = [...(index.articleSupportingEntities.get(article.id) ?? [])]
    return {
      id: article.id,
      sourceName: article.sourceName ?? null,
      title: article.title,
      url: article.url,
      origin: article.origin,
      publishedAt: article.published_at ?? null,
      fetchedAt: article.fetched_at,
      excerpt: excerpt(content),
      contentLength: content.length,
      contentHash: hash(content),
      partition: partitionName(article.id, partition),
      qualifyingEntities: entities,
      qualifyingSurfaces: [...(index.articleMentions.get(article.id) ?? [])],
      supportingEntities: supporting,
      supportingSurfaces: [...(index.articleSupportingMentions.get(article.id) ?? [])],
      approvalPath: correspondentApprovalPath(article)
        ?? (entities.length > 0 ? 'entity' : fallbackIds.has(article.id) ? 'explicit_edm_fallback' : 'rejected'),
      explicitEdmEvidence: hasExplicitEdmEvidence(article),
      llmEligible: eligibleIds.has(article.id),
    }
  })
  const saveable = filtered.suggestions.map((suggestion) => ({
    ...suggestionView(suggestion),
    articles: suggestion.articleIds.map((id) => {
      const article = articleMeta.get(id)
      return { id, title: article?.title ?? null }
    }),
  }))
  const rawSingletonArticleIds = new Set(rawLlm.flatMap((batch) =>
    batch.suggestions
      .filter(isSingletonRawSuggestion)
      .flatMap((suggestion: Suggestion) => suggestion.articleIds)
  ))
  const llmOmittedArticles = selected.input
    .filter((article) => !rawSingletonArticleIds.has(article.id))
    .map((article) => ({ id: article.id, title: article.title }))
  const rawMultiArticleSuggestionCount = drops.filter((drop) =>
    drop.reason === 'raw_multi_article_not_allowed'
  ).length

  const after = await databaseSnapshot(supabase)
  const unchanged = sameSnapshot(before, after)
  if (!unchanged) throw new Error('database snapshot changed during SELECT-only replay')
  const result = {
    replayVersion: 1,
    run: {
      startedAt,
      finishedAt: new Date().toISOString(),
      model,
      ollamaBaseUrlConfigured: Boolean(process.env.OLLAMA_BASE_URL),
      constants: {
        llmInputMax: LLM_INPUT_MAX,
        noEntityRatioMax: NO_ENTITY_RATIO_MAX,
        llmBatchSize: LLM_BATCH_SIZE,
        numCtx: 16384,
        timeoutMs: 180000,
      },
    },
    batch: { start: BATCH_START, end: BATCH_END, expected: EXPECTED_POOL },
    database: { before, after, unchanged },
    funnel: {
      exactPool: rawArticles.length,
      qualifying: partition.qualifying.length,
      danceExperience: partition.danceExperience.length,
      supportingOnly: partition.supportingOnly.length,
      notMatched: partition.notMatched.length,
      explicitFallback: fallbackIds.size,
      finalEligible: selected.input.length,
      llmBatches: batches.length,
      llmRawSuggestions: rawLlm.reduce((sum, batch) => sum + batch.suggestions.length, 0),
      rawMultiArticleSuggestions: rawMultiArticleSuggestionCount,
      normalized: normalized.length,
      merged: merged.length,
      ranked: ranked.length,
      duplicateOrBlocked: duplicateDetails.length,
      saveable: saveable.length,
    },
    articles: articleOutput,
    llmRaw: rawLlm,
    normalizedSuggestions: normalized.map(suggestionView),
    mergedSuggestions: merged.map(suggestionView),
    rankedSuggestions: ranked.map(suggestionView),
    duplicateFiltering: duplicateDetails,
    saveableSuggestions: saveable,
    llmOmittedArticles,
    drops,
  }
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(result, null, 2)}\n`)
  fs.writeFileSync(OUTPUT_MD, renderMarkdown(result))
  console.log(JSON.stringify({
    outputs: [OUTPUT_JSON, OUTPUT_MD],
    funnel: result.funnel,
    databaseUnchanged: unchanged,
  }, null, 2))
}

main().catch((error) => {
  console.error(String(error))
  process.exitCode = 1
})
