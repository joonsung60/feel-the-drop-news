import fs from 'node:fs'
import path from 'node:path'
import {
  PoolArticleMetadata,
  PoolSelection,
  selectSuggestPool,
} from '../lib/suggest/pool-selection'

type Row = PoolArticleMetadata & { suggestion_state: string | null }

const RUN_A = '10000000-0000-4000-8000-000000000001'
const RUN_B = '20000000-0000-4000-8000-000000000002'
const RUN_C = '30000000-0000-4000-8000-000000000003'
const OUTPUT_JSON = path.join(process.cwd(), 'research/suggest-pool-d-policy-simulation-2026-08-05.json')
const OUTPUT_MD = path.join(process.cwd(), 'research/suggest-pool-d-policy-simulation-2026-08-05.md')

class Query implements PromiseLike<{ data: Row[]; error: null }> {
  private rows: Row[]
  private orders: Array<{ column: string; ascending: boolean; nullsFirst?: boolean }> = []
  private cap: number | null = null

  constructor(rows: Row[]) {
    this.rows = [...rows]
  }

  select() { return this }
  or(filter: string) {
    if (filter.includes('suggestion_state.is.null,suggestion_state.eq.new')) {
      this.rows = this.rows.filter((row) =>
        row.suggestion_state === null || row.suggestion_state === 'new'
      )
    }
    const excludedRunIds = [
      ...filter.matchAll(/ingestion_run_id\.neq\.([0-9a-f-]+)/gi),
    ].map((match) => match[1])
    if (excludedRunIds.length > 0) {
      this.rows = this.rows.filter((row) =>
        row.ingestion_run_id === null || !excludedRunIds.includes(row.ingestion_run_id)
      )
    }
    if (filter.includes('origin.is.null,and(origin.neq.rss,origin.neq.correspondent)')) {
      this.rows = this.rows.filter((row) =>
        row.origin === null || (row.origin !== 'rss' && row.origin !== 'correspondent')
      )
    }
    return this
  }
  eq(column: keyof Row, value: unknown) {
    this.rows = this.rows.filter((row) => row[column] === value)
    return this
  }
  is(column: keyof Row, value: unknown) {
    this.rows = this.rows.filter((row) => row[column] === value)
    return this
  }
  not(column: keyof Row, operator: string, value: unknown) {
    if (operator === 'is') this.rows = this.rows.filter((row) => row[column] !== value)
    return this
  }
  in(column: keyof Row, values: string[]) {
    const accepted = new Set(values)
    this.rows = this.rows.filter((row) => accepted.has(String(row[column])))
    return this
  }
  order(column: string, options: { ascending: boolean; nullsFirst?: boolean }) {
    this.orders.push({ column, ...options })
    return this
  }
  limit(value: number) {
    this.cap = value
    return this
  }
  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    try {
      const sorted = [...this.rows].sort((left, right) => {
        for (const order of this.orders) {
          const a = left[order.column as keyof Row]
          const b = right[order.column as keyof Row]
          if (a === b) continue
          if (a === null || a === undefined) return order.nullsFirst === false ? 1 : -1
          if (b === null || b === undefined) return order.nullsFirst === false ? -1 : 1
          const comparison = String(a).localeCompare(String(b))
          return order.ascending ? comparison : -comparison
        }
        return 0
      })
      const value = { data: this.cap === null ? sorted : sorted.slice(0, this.cap), error: null }
      return Promise.resolve(onfulfilled ? onfulfilled(value) : value as TResult1)
    } catch (error) {
      return onrejected ? Promise.resolve(onrejected(error)) : Promise.reject(error)
    }
  }
}

class Database {
  constructor(readonly rows: Row[]) {}
  from(table: string) {
    if (table !== 'raw_articles') throw new Error(`unexpected table ${table}`)
    return new Query(this.rows)
  }
  mark(ids: string[], timestamp: string) {
    const selected = new Set(ids)
    for (const row of this.rows) {
      if (selected.has(row.id)) row.suggestion_last_checked_at = timestamp
    }
  }
}

function row(
  id: string,
  origin: string | null,
  source: number,
  runId: string | null,
  published: boolean,
  sequence: number,
): Row {
  return {
    id,
    source_id: origin === 'rss' ? `rss-${source}` : null,
    origin,
    published_at: published ? `2026-08-04T${String(sequence % 24).padStart(2, '0')}:00:00Z` : null,
    fetched_at: `2026-08-04T${String(sequence % 24).padStart(2, '0')}:30:00Z`,
    suggestion_last_checked_at: null,
    ingestion_run_id: runId,
    ingestion_source: origin === 'correspondent' ? `correspondent:${source}` : null,
    suggestion_state: 'new',
  }
}

function fixture(): Database {
  return new Database([
    ...Array.from({ length: 123 }, (_, index) =>
      row(`20260804-${String(index).padStart(3, '0')}`, 'rss', index % 12, RUN_A, index % 10 !== 0, index)
    ),
    ...Array.from({ length: 180 }, (_, index) =>
      row(`rss-backlog-${String(index).padStart(3, '0')}`, 'rss', index % 18, null, index % 3 !== 0, index)
    ),
    ...Array.from({ length: 80 }, (_, index) =>
      row(
        `corr-backlog-${String(index).padStart(3, '0')}`,
        'correspondent',
        index % 8,
        index < 10 ? RUN_C : null,
        index % 2 === 0,
        index,
      )
    ),
    ...Array.from({ length: 30 }, (_, index) =>
      row(`url-backlog-${String(index).padStart(3, '0')}`, 'url', 0, null, index % 2 === 0, index)
    ),
    ...Array.from({ length: 30 }, (_, index) =>
      row(`legacy-${String(index).padStart(3, '0')}`, null, 0, null, index % 2 === 0, index)
    ),
  ])
}

function compact(result: PoolSelection) {
  return {
    articleIds: result.articleIds,
    selected: result.articleIds.length,
    cohort: result.diagnostics.cohortSelected,
    fairRemainder: result.diagnostics.fairRemainderSelected,
    unchecked: result.diagnostics.unchecked,
    rechecked: result.diagnostics.rechecked,
    origin: result.diagnostics.origin,
    source: result.diagnostics.source,
    publication: result.diagnostics.publication,
  }
}

async function simulateLimit(limit: number) {
  const database = fixture()
  const runs = []
  for (let index = 0; index < 3; index++) {
    const result = await selectSuggestPool(database, {
      limit,
      preferredIngestionRunId: RUN_A,
    })
    runs.push(compact(result))
    database.mark(result.articleIds, `2026-08-05T0${index}:00:00Z`)
  }
  return runs
}

async function main() {
  const limits = Object.fromEntries(
    await Promise.all([100, 120, 200].map(async (limit) => [
      String(limit),
      await simulateLimit(limit),
    ])),
  )

  const correspondentDatabase = fixture()
  correspondentDatabase.rows.push(...Array.from({ length: 20 }, (_, index) =>
    row(`new-corr-${index}`, 'correspondent', index % 4, RUN_B, true, 23)
  ))
  const correspondentOnly = compact(await selectSuggestPool(correspondentDatabase, {
    limit: 100,
    preferredIngestionRunId: RUN_B,
  }))

  const output = {
    generatedAt: new Date().toISOString(),
    fixture: {
      referenceCohort: 123,
      rssBacklog: 180,
      newestCorrespondentCohort: 10,
      correspondentBacklog: 70,
      directUrlBacklog: 30,
      legacyBacklog: 30,
    },
    policy: 'cohort_fair_v1',
    limits,
    correspondentOnlyNewRun: correspondentOnly,
  }
  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(output, null, 2)}\n`)

  const rows = [100, 120, 200].flatMap((limit) =>
    (output.limits[String(limit)] as ReturnType<typeof compact>[]).map((run, index) =>
      `| ${limit} | ${index + 1} | ${run.cohort} | ${run.fairRemainder} | ${run.unchecked} | ${run.rechecked} | ${run.origin.rss ?? 0}/${run.origin.correspondent ?? 0}/${run.origin.url ?? 0}/${run.origin.legacy ?? 0} | ${run.publication.null}/${run.publication.dated} |`
    )
  )
  fs.writeFileSync(OUTPUT_MD, `# D suggest pool policy simulation — 2026-08-05

123-row 2026-08-04 cohort, 10-row newest correspondent cohort, and bounded backlog fixture. Exact selected IDs are in the JSON.

| Limit | Run | Cohort | Fair remainder | Unchecked | Rechecked | RSS/Corr/URL/Legacy | Null/Dated |
|---:|---:|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}

Correspondent-only new run at limit 100 selected ${correspondentOnly.cohort} cohort rows and ${correspondentOnly.origin.rss ?? 0} RSS backlog rows.
`)
  console.log(JSON.stringify(output, null, 2))
}

void main()
