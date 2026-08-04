/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  buildEntityIndex,
  loadEntityDictionary,
  parseEntityDictionary,
} from '../lib/suggest/entity-index'
import {
  partitionArticlesByEntityRole,
  selectEligibleLlmInput,
} from '../lib/suggest/eligibility'
import type { EntityEntry, RawArticle } from '../lib/suggest/types'

const LLM_INPUT_MAX = 120
const NO_ENTITY_RATIO_MAX = 0.6
const EXCERPT_LIMIT = 800
const DICTIONARY_PATH = path.join(process.cwd(), 'lib/edm-entities-v2.json')
const POLICY_PATH = path.join(process.cwd(), 'lib/entity-surface-policy.json')
const ADDENDUM_PATH = path.join(process.cwd(), 'research/entity-addendum-2026-08-04.json')
const CURRENT_AUDIT_PATH = path.join(process.cwd(), 'research/entity-recall-audit-2026-08-04.json')
const LABELS_PATH = path.join(process.cwd(), 'research/entity-merge-readiness-labels-2026-08-04.json')
const OUTPUT_PATH = path.join(process.cwd(), 'research/entity-merge-readiness-2026-08-04.json')
const SANITIZED_AUDIT_PATH = path.join(
  process.cwd(),
  'research/entity-recall-audit-2026-08-04.sanitized-proposed.json',
)

type EditorialLabel = 'editorially_relevant' | 'editorially_irrelevant' | 'ambiguous'
type AuditArticle = RawArticle & {
  origin: string | null
  fetched_at: string
}

type Batch = {
  id: string
  start: string
  end: string
  expectedCount: number
}

const BATCHES: Batch[] = [
  {
    id: '2026-08-04',
    start: '2026-08-04T08:46:35Z',
    end: '2026-08-04T08:49:30Z',
    expectedCount: 123,
  },
  {
    id: '2026-08-03',
    start: '2026-08-03T09:30:00.93733Z',
    end: '2026-08-03T09:32:04.888539Z',
    expectedCount: 61,
  },
  {
    id: '2026-08-01',
    start: '2026-08-01T10:57:37.890933Z',
    end: '2026-08-01T10:59:47.344501Z',
    expectedCount: 89,
  },
  {
    id: '2026-07-31',
    start: '2026-07-31T09:55:06.476512Z',
    end: '2026-07-31T09:57:43.636157Z',
    expectedCount: 128,
  },
]

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} environment variable is required`)
  return value
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function metric(value: number, denominator: number): number | null {
  return denominator === 0 ? null : Number((value / denominator).toFixed(4))
}

function evaluate(
  articles: AuditArticle[],
  dictionary: EntityEntry[],
  labels: Map<string, EditorialLabel>,
) {
  const index = buildEntityIndex(articles, dictionary)
  const partition = partitionArticlesByEntityRole(
    articles,
    index.articleEntities,
    index.articleSupportingEntities,
  )
  const selected = selectEligibleLlmInput(partition, LLM_INPUT_MAX, NO_ENTITY_RATIO_MAX)
  const eligibleIds = new Set(selected.input.map((article) => article.id))
  const decided = articles.filter((article) => {
    const label = labels.get(article.id)
    return label === 'editorially_relevant' || label === 'editorially_irrelevant'
  })
  const tp = decided.filter((article) =>
    labels.get(article.id) === 'editorially_relevant' && eligibleIds.has(article.id)
  ).length
  const fp = decided.filter((article) =>
    labels.get(article.id) === 'editorially_irrelevant' && eligibleIds.has(article.id)
  ).length
  const fn = decided.filter((article) =>
    labels.get(article.id) === 'editorially_relevant' && !eligibleIds.has(article.id)
  ).length
  const tn = decided.filter((article) =>
    labels.get(article.id) === 'editorially_irrelevant' && !eligibleIds.has(article.id)
  ).length
  return {
    index,
    eligibleIds,
    summary: {
      total: articles.length,
      qualifying: partition.qualifying.length,
      danceExperience: partition.danceExperience.length,
      supportingOnly: partition.supportingOnly.length,
      notMatched: partition.notMatched.length,
      eligible: selected.input.length,
      labeled: decided.length,
      ambiguous: articles.filter((article) => labels.get(article.id) === 'ambiguous').length,
      unlabeled: articles.filter((article) => !labels.has(article.id)).length,
      true_positive: tp,
      false_positive: fp,
      false_negative: fn,
      true_negative: tn,
      precision: metric(tp, tp + fp),
      recall: metric(tp, tp + fn),
    },
  }
}

function withOzoraPolicy(basePolicy: any) {
  return {
    ...basePolicy,
    entities: {
      ...basePolicy.entities,
      'O.Z.O.R.A. Festival': {
        contextual_surfaces: {
          Ozora: {
            before: ['festival', 'psytrance', 'psychedelic trance'],
            after: ['festival', 'psytrance', 'psychedelic trance'],
            max_gap_chars: 12,
          },
        },
      },
    },
  }
}

function dictionaryVariant(
  baseDictionary: any,
  basePolicy: any,
  addendum: any,
  mode: 'base' | 'ozora_a' | 'ozora_b' | 'all',
): EntityEntry[] {
  if (mode === 'base') return loadEntityDictionary()
  const additions = mode === 'all'
    ? addendum.entities
    : addendum.entities
      .filter((entity: any) => entity.id === 'festival_ozora')
      .map((entity: any) => mode === 'ozora_b'
        ? { ...entity, aliases_en: ['Ozora Festival', 'Ozora'] }
        : entity
      )
  const combined = {
    ...baseDictionary,
    entities: [...baseDictionary.entities, ...additions],
  }
  const policy = mode === 'ozora_b' ? withOzoraPolicy(basePolicy) : basePolicy
  return parseEntityDictionary(JSON.stringify(combined), JSON.stringify(policy))
}

async function main() {
  const supabase = createClient(
    requiredEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
  const baseDictionary = readJson(DICTIONARY_PATH)
  const basePolicy = readJson(POLICY_PATH)
  const addendum = readJson(ADDENDUM_PATH)
  const currentAudit = readJson(CURRENT_AUDIT_PATH)
  const labelFile = fs.existsSync(LABELS_PATH) ? readJson(LABELS_PATH) : { labels: {}, batch_labels: {} }
  const labels = new Map<string, EditorialLabel>(
    Object.entries(labelFile.labels ?? {}) as Array<[string, EditorialLabel]>,
  )
  for (const article of currentAudit.articles) {
    labels.set(article.article_id, article.editorial_label)
  }

  const dictionaries = {
    base: dictionaryVariant(baseDictionary, basePolicy, addendum, 'base'),
    ozora_a: dictionaryVariant(baseDictionary, basePolicy, addendum, 'ozora_a'),
    ozora_b: dictionaryVariant(baseDictionary, basePolicy, addendum, 'ozora_b'),
    all: dictionaryVariant(baseDictionary, basePolicy, addendum, 'all'),
  }

  const outputBatches = []
  const allSurfaceHits: Record<string, any[]> = {
    Ozora_A: [],
    Ozora_B: [],
    Giom: [],
    Better: [],
    ADVANCED: [],
    Bandcamp: [],
  }
  const individualImpact = Object.fromEntries(
    addendum.entities.map((entity: any) => [entity.id, []]),
  ) as Record<string, any[]>

  for (const batch of BATCHES) {
    const { data, error } = await supabase
      .from('raw_articles')
      .select('id, title, content, url, source_id, published_at, event_date, facts, origin, fetched_at')
      .gte('fetched_at', batch.start)
      .lte('fetched_at', batch.end)
      .eq('origin', 'rss')
      .order('published_at', { ascending: false })
      .order('fetched_at', { ascending: true })
    if (error) throw new Error(`${batch.id} raw_articles SELECT failed: ${error.message}`)
    if (data.length !== batch.expectedCount) {
      throw new Error(`${batch.id} cardinality mismatch: expected ${batch.expectedCount}, got ${data.length}`)
    }
    const sourceIds = [...new Set(data.map((row) => row.source_id).filter((id) => id !== null))]
    const { data: sources, error: sourceError } = await supabase
      .from('rss_sources')
      .select('id, name')
      .in('id', sourceIds)
    if (sourceError) throw new Error(`${batch.id} rss_sources SELECT failed: ${sourceError.message}`)
    const sourceNames = new Map(sources.map((source) => [String(source.id), source.name]))
    const articles = data.map((row) => ({
      ...row,
      sourceName: row.source_id === null ? undefined : sourceNames.get(String(row.source_id)) ?? undefined,
    })) as AuditArticle[]
    const batchLabels = labelFile.batch_labels?.[batch.id]
    if (batchLabels) {
      const irrelevant = new Set<number>(batchLabels.editorially_irrelevant ?? [])
      const ambiguous = new Set<number>(batchLabels.ambiguous ?? [])
      for (const [index, article] of articles.entries()) {
        const position = index + 1
        if (irrelevant.has(position)) {
          labels.set(article.id, 'editorially_irrelevant')
        } else if (ambiguous.has(position)) {
          labels.set(article.id, 'ambiguous')
        } else {
          labels.set(article.id, 'editorially_relevant')
        }
      }
    }

    const results = {
      base: evaluate(articles, dictionaries.base, labels),
      ozora_a: evaluate(articles, dictionaries.ozora_a, labels),
      ozora_b: evaluate(articles, dictionaries.ozora_b, labels),
      all: evaluate(articles, dictionaries.all, labels),
    }
    const baseEligible = results.base.eligibleIds
    const allEligible = results.all.eligibleIds

    for (const [surface, resultKey, canonical] of [
      ['Ozora_A', 'ozora_a', 'O.Z.O.R.A. Festival'],
      ['Ozora_B', 'ozora_b', 'O.Z.O.R.A. Festival'],
      ['Giom', 'all', 'Giom'],
      ['Better', 'base', 'Better'],
      ['ADVANCED', 'base', 'ADVANCED'],
      ['Bandcamp', 'base', 'Bandcamp'],
    ] as const) {
      const result = results[resultKey]
      for (const article of articles) {
        if (result.index.articleEntities.get(article.id)?.has(canonical)) {
          allSurfaceHits[surface].push({
            batch: batch.id,
            article_id: article.id,
            source_name: article.sourceName ?? null,
            title: article.title,
            editorial_label: labels.get(article.id) ?? null,
            newly_eligible: !baseEligible.has(article.id) && result.eligibleIds.has(article.id),
          })
        }
      }
    }

    for (const entity of addendum.entities) {
      const singleDictionary = parseEntityDictionary(
        JSON.stringify({
          ...baseDictionary,
          entities: [...baseDictionary.entities, entity],
        }),
        JSON.stringify(basePolicy),
      )
      const single = evaluate(articles, singleDictionary, labels)
      const newArticleIds = articles
        .filter((article) => !baseEligible.has(article.id) && single.eligibleIds.has(article.id))
        .map((article) => ({
          batch: batch.id,
          article_id: article.id,
          title: article.title,
          editorial_label: labels.get(article.id) ?? null,
        }))
      individualImpact[entity.id].push(...newArticleIds)
    }

    outputBatches.push({
      id: batch.id,
      start: batch.start,
      end: batch.end,
      expected_count: batch.expectedCount,
      actual_count: articles.length,
      base: results.base.summary,
      ozora_a: results.ozora_a.summary,
      ozora_b: results.ozora_b.summary,
      all: results.all.summary,
      newly_eligible_all: articles
        .filter((article) => !baseEligible.has(article.id) && allEligible.has(article.id))
        .map((article) => ({
          article_id: article.id,
          title: article.title,
          editorial_label: labels.get(article.id) ?? null,
          entities: [...(results.all.index.articleEntities.get(article.id) ?? [])]
            .filter((entity) => !(results.base.index.articleEntities.get(article.id) ?? new Set()).has(entity)),
        })),
      articles: articles.map((article) => {
        const content = article.content ?? ''
        return {
          article_id: article.id,
          source_name: article.sourceName ?? null,
          title: article.title,
          origin: article.origin,
          published_at: article.published_at ?? null,
          fetched_at: article.fetched_at,
          excerpt: content.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LIMIT),
          contentLength: content.length,
          contentHash: createHash('sha256').update(content).digest('hex'),
          editorial_label: labels.get(article.id) ?? null,
          base_qualifying_entities: [...(results.base.index.articleEntities.get(article.id) ?? [])],
          base_eligible: baseEligible.has(article.id),
          addendum_qualifying_entities: [...(results.all.index.articleEntities.get(article.id) ?? [])],
          addendum_eligible: allEligible.has(article.id),
        }
      }),
    })
  }

  const sweepRows: any[] = []
  const sweepPageSize = 1000
  const sweepSurfaces = [
    'Ozora', 'Giom', 'Better', 'ADVANCED', 'Bandcamp', 'Tiestö',
    ...addendum.entities.flatMap((entity: any) => [entity.en, ...entity.aliases_en]),
  ]
  const sweepFilter = [...new Set(sweepSurfaces.map((surface) => surface.toLowerCase()))]
    .flatMap((surface) => [
      `title.ilike.%${surface}%`,
      `content.ilike.%${surface}%`,
    ])
    .join(',')
  for (let from = 0; ; from += sweepPageSize) {
    const { data, error } = await supabase
      .from('raw_articles')
      .select('id, title, content, url, source_id, published_at, event_date, facts, origin, fetched_at')
      .eq('origin', 'rss')
      .or(sweepFilter)
      .order('fetched_at', { ascending: true })
      .range(from, from + sweepPageSize - 1)
    if (error) throw new Error(`global surface sweep SELECT failed: ${error.message}`)
    sweepRows.push(...data)
    if (data.length < sweepPageSize) break
  }
  const sweepSourceIds = [...new Set(sweepRows.map((row) => row.source_id).filter((id) => id !== null))]
  const { data: sweepSources, error: sweepSourceError } = await supabase
    .from('rss_sources')
    .select('id, name')
    .in('id', sweepSourceIds)
  if (sweepSourceError) throw new Error(`global surface sweep rss_sources SELECT failed: ${sweepSourceError.message}`)
  const sweepSourceNames = new Map(sweepSources.map((source) => [String(source.id), source.name]))
  const sweepArticles = sweepRows.map((row) => ({
    ...row,
    sourceName: row.source_id === null ? undefined : sweepSourceNames.get(String(row.source_id)) ?? undefined,
  })) as AuditArticle[]
  const sweepResults = {
    base: evaluate(sweepArticles, dictionaries.base, labels),
    ozora_a: evaluate(sweepArticles, dictionaries.ozora_a, labels),
    ozora_b: evaluate(sweepArticles, dictionaries.ozora_b, labels),
    all: evaluate(sweepArticles, dictionaries.all, labels),
  }
  const globalSurfaceSweep = Object.fromEntries(
    ([
      ['Ozora_A', 'ozora_a', 'O.Z.O.R.A. Festival', 'Ozora'],
      ['Ozora_B', 'ozora_b', 'O.Z.O.R.A. Festival', 'Ozora'],
      ['Giom', 'all', 'Giom', 'Giom'],
      ['Better', 'base', 'Better', 'Better'],
      ['ADVANCED', 'base', 'ADVANCED', 'ADVANCED'],
      ['Bandcamp', 'base', 'Bandcamp', 'Bandcamp'],
    ] as const).map(([surface, resultKey, canonical, rawNeedle]) => [
      surface,
      sweepArticles
        .filter((article) => {
          const rawText = `${article.title}\n${article.content ?? ''}`.toLowerCase()
          return rawText.includes(rawNeedle.toLowerCase())
        })
        .map((article) => {
          const content = article.content ?? ''
          return {
            article_id: article.id,
            source_name: article.sourceName ?? null,
            title: article.title,
            fetched_at: article.fetched_at,
            matched: sweepResults[resultKey].index.articleEntities.get(article.id)?.has(canonical) ?? false,
            editorial_label: labels.get(article.id) ?? null,
            excerpt: content.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LIMIT),
            contentLength: content.length,
            contentHash: createHash('sha256').update(content).digest('hex'),
          }
        }),
    ]),
  ) as Record<string, any[]>
  globalSurfaceSweep.Tiestö = sweepArticles
    .filter((article) => `${article.title}\n${article.content ?? ''}`.toLowerCase().includes('tiestö'))
    .map((article) => {
      const content = article.content ?? ''
      return {
        article_id: article.id,
        source_name: article.sourceName ?? null,
        title: article.title,
        fetched_at: article.fetched_at,
        base_matches_tiesto: sweepResults.base.index.articleEntities.get(article.id)?.has('Tiësto') ?? false,
        editorial_label: labels.get(article.id) ?? null,
        excerpt: content.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LIMIT),
        contentLength: content.length,
        contentHash: createHash('sha256').update(content).digest('hex'),
      }
    })
  globalSurfaceSweep.addendum_entities = addendum.entities.map((entity: any) => ({
    id: entity.id,
    en: entity.en,
    aliases_en: entity.aliases_en,
    matches: sweepArticles
      .filter((article) => sweepResults.all.index.articleEntities.get(article.id)?.has(entity.en))
      .map((article) => {
        const content = article.content ?? ''
        return {
          article_id: article.id,
          source_name: article.sourceName ?? null,
          title: article.title,
          fetched_at: article.fetched_at,
          editorial_label: labels.get(article.id) ?? null,
          excerpt: content.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LIMIT),
          contentLength: content.length,
          contentHash: createHash('sha256').update(content).digest('hex'),
        }
      }),
  }))

  const recalculatedCounts = {
    artist: baseDictionary.entities.filter((entity: any) => entity.type === 'artist').length
      + addendum.entities.filter((entity: any) => entity.type === 'artist').length,
    equipment: baseDictionary.entities.filter((entity: any) => entity.type === 'equipment').length
      + addendum.entities.filter((entity: any) => entity.type === 'equipment').length,
    festival: baseDictionary.entities.filter((entity: any) => entity.type === 'festival').length
      + addendum.entities.filter((entity: any) => entity.type === 'festival').length,
    label: baseDictionary.entities.filter((entity: any) => entity.type === 'label').length
      + addendum.entities.filter((entity: any) => entity.type === 'label').length,
    venue: baseDictionary.entities.filter((entity: any) => entity.type === 'venue').length
      + addendum.entities.filter((entity: any) => entity.type === 'venue').length,
    total: baseDictionary.entities.length + addendum.entities.length,
    ko_established: [...baseDictionary.entities, ...addendum.entities]
      .filter((entity: any) => entity.ko_status === 'established').length,
  }

  const output = {
    version: 1,
    generated_at: new Date().toISOString(),
    parameters: {
      llm_input_max: LLM_INPUT_MAX,
      no_entity_ratio_max: NO_ENTITY_RATIO_MAX,
      excerpt_limit: EXCERPT_LIMIT,
    },
    metadata_counts: {
      base_entities_actual: baseDictionary.entities.length,
      addendum_entities: addendum.entities.length,
      merged: recalculatedCounts,
    },
    batches: outputBatches,
    surface_audit: allSurfaceHits,
    global_surface_sweep: {
      raw_candidate_count: sweepArticles.length,
      surfaces: globalSurfaceSweep,
    },
    individual_addendum_impact: individualImpact,
  }
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  const sanitizedCurrentAudit = {
    ...currentAudit,
    articles: currentAudit.articles.map((article: any) => {
      const content = article.content ?? ''
      const { content: _removed, ...withoutContent } = article
      void _removed
      return {
        ...withoutContent,
        excerpt: content.replace(/\s+/g, ' ').trim().slice(0, EXCERPT_LIMIT),
        contentLength: content.length,
        contentHash: createHash('sha256').update(content).digest('hex'),
      }
    }),
  }
  fs.writeFileSync(
    SANITIZED_AUDIT_PATH,
    `${JSON.stringify(sanitizedCurrentAudit, null, 2)}\n`,
    'utf8',
  )
  console.log(JSON.stringify({
    output: OUTPUT_PATH,
    sanitized_audit: SANITIZED_AUDIT_PATH,
    batches: outputBatches.map((batch) => ({
      id: batch.id,
      count: batch.actual_count,
      unlabeled: batch.base.unlabeled,
    })),
    metadata_counts: output.metadata_counts,
  }))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
