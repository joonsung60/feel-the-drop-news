import type { RawArticle } from './types'

const ELIGIBLE_FILTER = 'suggestion_state.is.null,suggestion_state.eq.new'
const METADATA_COLUMNS = [
  'id',
  'source_id',
  'origin',
  'published_at',
  'fetched_at',
  'suggestion_last_checked_at',
  'ingestion_run_id',
  'ingestion_source',
].join(', ')
const HYDRATION_COLUMNS =
  'id, title, content, url, source_id, published_at, event_date, facts'
const COHORT_RATIO = 0.7
const OVERFETCH_FACTOR = 3
const FAIR_QUEUE_DEFINITIONS = [
  { origin: 'rss', cohort: true, publishedIsNull: false, weight: 4 },
  { origin: 'rss', cohort: true, publishedIsNull: true, weight: 4 },
  { origin: 'correspondent', cohort: true, publishedIsNull: false, weight: 3 },
  { origin: 'correspondent', cohort: true, publishedIsNull: true, weight: 3 },
  { origin: 'rss', cohort: false, publishedIsNull: false, weight: 1 },
  { origin: 'rss', cohort: false, publishedIsNull: true, weight: 1 },
  { origin: 'correspondent', cohort: false, publishedIsNull: false, weight: 1 },
  { origin: 'correspondent', cohort: false, publishedIsNull: true, weight: 1 },
  { origin: 'legacy', cohort: false, publishedIsNull: false, weight: 1 },
  { origin: 'legacy', cohort: false, publishedIsNull: true, weight: 1 },
] as const

export type PoolPolicy = 'cohort_fair_v1' | 'legacy_published_at'

export type PoolArticleMetadata = {
  id: string
  source_id: string | number | null
  origin: string | null
  published_at: string | null
  fetched_at: string
  suggestion_last_checked_at: string | null
  ingestion_run_id: string | null
  ingestion_source: string | null
}

export type PoolSelectionDiagnostics = {
  policy: PoolPolicy
  preferredIngestionRunId: string | null
  resolvedIngestionRunId: string | null
  invalidPreferredIngestionRunId: boolean
  cohortEntitlement: number
  cohortSelected: number
  fairRemainderSelected: number
  unchecked: number
  rechecked: number
  origin: Record<string, number>
  source: Record<string, number>
  publication: { null: number; dated: number }
}

export type PoolSelection = {
  articleIds: string[]
  metadata: PoolArticleMetadata[]
  diagnostics: PoolSelectionDiagnostics
}

type QueryResult = {
  data: unknown[] | null
  error: { message: string } | null
}

type QueryLike = PromiseLike<QueryResult> & {
  select: (columns: string) => QueryLike
  or: (filter: string) => QueryLike
  eq: (column: string, value: unknown) => QueryLike
  is: (column: string, value: unknown) => QueryLike
  not: (column: string, operator: string, value: unknown) => QueryLike
  order: (
    column: string,
    options: { ascending: boolean; nullsFirst?: boolean },
  ) => QueryLike
  limit: (value: number) => QueryLike
  in: (column: string, values: string[]) => QueryLike
}

type SupabaseClientLike = {
  from: (table: string) => {
    select: (columns: string) => QueryLike
  }
}

function sourceKey(article: PoolArticleMetadata): string {
  if (article.origin === 'rss' && article.source_id !== null) {
    return `rss:${String(article.source_id)}`
  }
  return article.ingestion_source
    ?? `${article.origin ?? 'legacy'}:unknown`
}

function sourceRoundRobinGroup(rows: PoolArticleMetadata[]): PoolArticleMetadata[] {
  const queues = new Map<string, PoolArticleMetadata[]>()
  for (const row of rows) {
    const key = sourceKey(row)
    const queue = queues.get(key) ?? []
    queue.push(row)
    queues.set(key, queue)
  }

  const result: PoolArticleMetadata[] = []
  while ([...queues.values()].some((queue) => queue.length > 0)) {
    for (const queue of queues.values()) {
      const next = queue.shift()
      if (next) result.push(next)
    }
  }
  return result
}

function sourceRoundRobin(rows: PoolArticleMetadata[]): PoolArticleMetadata[] {
  return [
    ...sourceRoundRobinGroup(rows.filter((row) => row.suggestion_last_checked_at === null)),
    ...sourceRoundRobinGroup(rows.filter((row) => row.suggestion_last_checked_at !== null)),
  ]
}

function queueRoundRobin(
  queues: Array<{ rows: PoolArticleMetadata[]; weight: number }>,
  limit: number,
): PoolArticleMetadata[] {
  const selected: PoolArticleMetadata[] = []
  const selectedIds = new Set<string>()
  while (selected.length < limit && queues.some((queue) => queue.rows.length > 0)) {
    let progressed = false
    for (const queue of queues) {
      for (let count = 0; count < queue.weight && selected.length < limit; count++) {
        while (queue.rows.length > 0) {
          const next = queue.rows.shift()!
          if (selectedIds.has(next.id)) continue
          selected.push(next)
          selectedIds.add(next.id)
          progressed = true
          break
        }
      }
    }
    if (!progressed) break
  }
  return selected
}

function excludeIngestionRunsFilter(runIds: Array<string | null>): string | null {
  const unique = [...new Set(runIds.filter((runId): runId is string => Boolean(runId)))]
  if (unique.length === 0) return null
  if (unique.length === 1) {
    return `ingestion_run_id.is.null,ingestion_run_id.neq.${unique[0]}`
  }
  return `ingestion_run_id.is.null,and(${
    unique.map((runId) => `ingestion_run_id.neq.${runId}`).join(',')
  })`
}

function orderedMetadataQuery(
  client: SupabaseClientLike,
  additionalOrFilters: string[] = [],
) {
  const logicalFilter = additionalOrFilters.length === 0
    ? ELIGIBLE_FILTER
    : `and(or(${ELIGIBLE_FILTER}),${
      additionalOrFilters.map((filter) => `or(${filter})`).join(',')
    })`
  return client
    .from('raw_articles')
    .select(METADATA_COLUMNS)
    .or(logicalFilter)
    .order('suggestion_last_checked_at', { ascending: true, nullsFirst: true })
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('fetched_at', { ascending: false })
    .order('id', { ascending: true })
}

async function resolveIngestionRunId(
  client: SupabaseClientLike,
  preferredIngestionRunId: string | null,
): Promise<{ runId: string | null; invalidPreferred: boolean }> {
  const validPreferred = preferredIngestionRunId
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(preferredIngestionRunId)
    ? preferredIngestionRunId
    : null
  if (validPreferred) {
    const { data, error } = await client
      .from('raw_articles')
      .select('ingestion_run_id')
      .or(ELIGIBLE_FILTER)
      .eq('ingestion_run_id', preferredIngestionRunId)
      .limit(1)
    if (error) throw new Error(`preferred ingestion run lookup failed: ${error.message}`)
    if ((data?.length ?? 0) > 0) {
      return { runId: validPreferred, invalidPreferred: false }
    }
  }

  const { data, error } = await client
    .from('raw_articles')
    .select('ingestion_run_id, fetched_at')
    .or(ELIGIBLE_FILTER)
    .not('ingestion_run_id', 'is', null)
    .order('fetched_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(`latest ingestion run lookup failed: ${error.message}`)
  const latest = data?.[0] as { ingestion_run_id?: string | null } | undefined
  return {
    runId: latest?.ingestion_run_id ?? null,
    invalidPreferred: Boolean(preferredIngestionRunId),
  }
}

async function fetchCohort(
  client: SupabaseClientLike,
  runId: string,
  entitlement: number,
): Promise<PoolArticleMetadata[]> {
  const { data, error } = await orderedMetadataQuery(client)
    .eq('ingestion_run_id', runId)
    .limit(Math.max(entitlement, entitlement * OVERFETCH_FACTOR))
  if (error) throw new Error(`ingestion cohort query failed: ${error.message}`)
  return sourceRoundRobin((data ?? []) as PoolArticleMetadata[]).slice(0, entitlement)
}

async function fetchFairQueues(
  client: SupabaseClientLike,
  resolvedRunId: string | null,
  requested: number,
): Promise<Array<{ rows: PoolArticleMetadata[]; weight: number }>> {
  const perQueueLimit = Math.max(12, requested * OVERFETCH_FACTOR)
  const latestByOrigin = new Map<string, string | null>()
  await Promise.all((['rss', 'correspondent'] as const).map(async (origin) => {
    const { data, error } = await client
      .from('raw_articles')
      .select('ingestion_run_id, fetched_at')
      .or(ELIGIBLE_FILTER)
      .eq('origin', origin)
      .not('ingestion_run_id', 'is', null)
      .order('fetched_at', { ascending: false })
      .limit(1)
    if (error) throw new Error(`latest ${origin} ingestion run lookup failed: ${error.message}`)
    const latest = data?.[0] as { ingestion_run_id?: string | null } | undefined
    latestByOrigin.set(origin, latest?.ingestion_run_id ?? null)
  }))

  const queues = await Promise.all(FAIR_QUEUE_DEFINITIONS.map(async (definition) => {
      const { origin, cohort, publishedIsNull, weight } = definition
      const additionalOrFilters = []
      if (origin === 'legacy') {
        additionalOrFilters.push(
          'origin.is.null,and(origin.neq.rss,origin.neq.correspondent)',
        )
      }
      const latestOriginRunId = origin === 'legacy' ? null : latestByOrigin.get(origin) ?? null
      if (!cohort) {
        const exclusion = excludeIngestionRunsFilter([resolvedRunId, latestOriginRunId])
        if (exclusion) additionalOrFilters.push(exclusion)
      }
      let query = orderedMetadataQuery(client, additionalOrFilters)
      if (origin !== 'legacy') query = query.eq('origin', origin)
      if (cohort) {
        if (!latestOriginRunId || latestOriginRunId === resolvedRunId) {
          return { rows: [], weight }
        }
        query = query.eq('ingestion_run_id', latestOriginRunId)
      }
      query = publishedIsNull
        ? query.is('published_at', null)
        : query.not('published_at', 'is', null)
      const { data, error } = await query.limit(perQueueLimit)
      if (error) {
        throw new Error(
          `fair queue query failed (${origin}/${publishedIsNull ? 'null' : 'dated'}): ${error.message}`,
        )
      }
      return {
        rows: sourceRoundRobin((data ?? []) as PoolArticleMetadata[]),
        weight,
      }
  }))
  return queues
}

function diagnostics(
  metadata: PoolArticleMetadata[],
  policy: PoolPolicy,
  preferredIngestionRunId: string | null,
  resolvedIngestionRunId: string | null,
  invalidPreferredIngestionRunId: boolean,
  cohortEntitlement: number,
  cohortSelected: number,
): PoolSelectionDiagnostics {
  const origin: Record<string, number> = {}
  const source: Record<string, number> = {}
  for (const row of metadata) {
    const originKey = row.origin ?? 'legacy'
    origin[originKey] = (origin[originKey] ?? 0) + 1
    const key = sourceKey(row)
    source[key] = (source[key] ?? 0) + 1
  }
  return {
    policy,
    preferredIngestionRunId,
    resolvedIngestionRunId,
    invalidPreferredIngestionRunId,
    cohortEntitlement,
    cohortSelected,
    fairRemainderSelected: metadata.length - cohortSelected,
    unchecked: metadata.filter((row) => row.suggestion_last_checked_at === null).length,
    rechecked: metadata.filter((row) => row.suggestion_last_checked_at !== null).length,
    origin,
    source,
    publication: {
      null: metadata.filter((row) => row.published_at === null).length,
      dated: metadata.filter((row) => row.published_at !== null).length,
    },
  }
}

export function suggestPoolPolicy(value = process.env.SUGGEST_POOL_POLICY): PoolPolicy {
  return value === 'legacy' ? 'legacy_published_at' : 'cohort_fair_v1'
}

export async function selectSuggestPool(
  clientValue: unknown,
  {
    limit,
    preferredIngestionRunId = null,
    policy = suggestPoolPolicy(),
  }: {
    limit: number
    preferredIngestionRunId?: string | null
    policy?: PoolPolicy
  },
): Promise<PoolSelection> {
  const client = clientValue as SupabaseClientLike
  if (policy === 'legacy_published_at') {
    const { data, error } = await client
      .from('raw_articles')
      .select(METADATA_COLUMNS)
      .or(ELIGIBLE_FILTER)
      .order('published_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(`legacy pool query failed: ${error.message}`)
    const metadata = (data ?? []) as PoolArticleMetadata[]
    return {
      articleIds: metadata.map(({ id }) => id),
      metadata,
      diagnostics: diagnostics(
        metadata, policy, preferredIngestionRunId, null, false, 0, 0,
      ),
    }
  }

  const { runId, invalidPreferred } =
    await resolveIngestionRunId(client, preferredIngestionRunId)
  const cohortEntitlement = runId ? Math.ceil(limit * COHORT_RATIO) : 0
  const cohort = runId
    ? await fetchCohort(client, runId, cohortEntitlement)
    : []
  const fairLimit = Math.max(0, limit - cohort.length)
  const fairQueues = fairLimit > 0
    ? await fetchFairQueues(client, runId, fairLimit)
    : []
  const cohortIds = new Set(cohort.map(({ id }) => id))
  const remainder = queueRoundRobin(
    fairQueues.map((queue) => ({
      ...queue,
      rows: queue.rows.filter((row) => !cohortIds.has(row.id)),
    })),
    fairLimit,
  )
  const metadata = [...cohort, ...remainder].slice(0, limit)
  return {
    articleIds: metadata.map(({ id }) => id),
    metadata,
    diagnostics: diagnostics(
      metadata,
      policy,
      preferredIngestionRunId,
      runId,
      invalidPreferred,
      cohortEntitlement,
      cohort.length,
    ),
  }
}

export async function hydrateSelectedArticles(
  clientValue: unknown,
  articleIds: string[],
): Promise<RawArticle[]> {
  const client = clientValue as SupabaseClientLike
  if (articleIds.length === 0) return []
  const { data, error } = await client
    .from('raw_articles')
    .select(HYDRATION_COLUMNS)
    .in('id', articleIds)
  if (error) throw new Error(`selected article hydration failed: ${error.message}`)
  const byId = new Map(
    ((data ?? []) as RawArticle[]).map((article) => [article.id, article]),
  )
  return articleIds
    .map((id) => byId.get(id))
    .filter((article): article is RawArticle => Boolean(article))
}
