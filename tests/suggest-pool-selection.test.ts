import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PoolArticleMetadata,
  selectSuggestPool,
} from '../lib/suggest/pool-selection'

type Row = PoolArticleMetadata & {
  suggestion_state: string | null
  title?: string
  content?: string
  url?: string
}

class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  private rows: Row[]
  private orders: Array<{
    column: string
    ascending: boolean
    nullsFirst?: boolean
  }> = []
  private cap: number | null = null

  constructor(rows: Row[]) {
    this.rows = [...rows]
  }

  select() {
    return this
  }

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
    if (operator === 'is') {
      this.rows = this.rows.filter((row) => row[column] !== value)
    }
    return this
  }

  in(column: keyof Row, values: string[]) {
    const accepted = new Set(values)
    this.rows = this.rows.filter((row) => accepted.has(String(row[column])))
    return this
  }

  order(
    column: string,
    options: { ascending: boolean; nullsFirst?: boolean },
  ) {
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
      const rows = [...this.rows].sort((a, b) => {
        for (const order of this.orders) {
          const left = a[order.column as keyof Row] as unknown
          const right = b[order.column as keyof Row] as unknown
          if (left === right) continue
          if (left === null || left === undefined) {
            return order.nullsFirst === false ? 1 : -1
          }
          if (right === null || right === undefined) {
            return order.nullsFirst === false ? -1 : 1
          }
          const comparison = String(left).localeCompare(String(right))
          return order.ascending ? comparison : -comparison
        }
        return 0
      })
      const value = {
        data: this.cap === null ? rows : rows.slice(0, this.cap),
        error: null,
      }
      return Promise.resolve(onfulfilled ? onfulfilled(value) : value as TResult1)
    } catch (error) {
      return onrejected
        ? Promise.resolve(onrejected(error))
        : Promise.reject(error)
    }
  }
}

class FakeSupabase {
  constructor(readonly rows: Row[]) {}

  from(table: string) {
    assert.equal(table, 'raw_articles')
    return new FakeQuery(this.rows)
  }

  markChecked(ids: string[], at: string) {
    const selected = new Set(ids)
    for (const row of this.rows) {
      if (selected.has(row.id)) row.suggestion_last_checked_at = at
    }
  }
}

const RUN_A = '10000000-0000-4000-8000-000000000001'
const RUN_B = '20000000-0000-4000-8000-000000000002'

function article(
  id: string,
  {
    runId = null,
    origin = 'rss',
    source = 0,
    published = true,
    fetchedOffset = 0,
  }: {
    runId?: string | null
    origin?: string | null
    source?: number
    published?: boolean
    fetchedOffset?: number
  } = {},
): Row {
  return {
    id,
    source_id: origin === 'rss' ? `source-${source}` : null,
    origin,
    published_at: published ? `2026-08-04T${String(fetchedOffset % 24).padStart(2, '0')}:00:00Z` : null,
    fetched_at: `2026-08-04T${String(fetchedOffset % 24).padStart(2, '0')}:30:00Z`,
    suggestion_last_checked_at: null,
    ingestion_run_id: runId,
    ingestion_source: origin === 'correspondent' ? `correspondent:${source}` : null,
    suggestion_state: 'new',
  }
}

function fixture() {
  const cohort = Array.from({ length: 123 }, (_, index) =>
    article(`cohort-${String(index).padStart(3, '0')}`, {
      runId: RUN_A,
      source: index % 12,
      published: index % 10 !== 0,
      fetchedOffset: index,
    })
  )
  const rssBacklog = Array.from({ length: 180 }, (_, index) =>
    article(`rss-backlog-${String(index).padStart(3, '0')}`, {
      source: index % 18,
      published: index % 3 !== 0,
      fetchedOffset: index,
    })
  )
  const correspondent = Array.from({ length: 80 }, (_, index) =>
    article(`corr-backlog-${String(index).padStart(3, '0')}`, {
      origin: 'correspondent',
      source: index % 8,
      published: index % 2 === 0,
      fetchedOffset: index,
    })
  )
  const direct = Array.from({ length: 30 }, (_, index) =>
    article(`url-backlog-${String(index).padStart(3, '0')}`, {
      origin: 'url',
      source: 0,
      published: index % 2 === 0,
      fetchedOffset: index,
    })
  )
  const legacy = Array.from({ length: 30 }, (_, index) =>
    article(`legacy-${String(index).padStart(3, '0')}`, {
      origin: null,
      published: index % 2 === 0,
      fetchedOffset: index,
    })
  )
  return new FakeSupabase([...cohort, ...rssBacklog, ...correspondent, ...direct, ...legacy])
}

test('D selector drains an explicit 123-row cohort across consecutive runs', async () => {
  const database = fixture()
  const first = await selectSuggestPool(database, {
    limit: 100,
    preferredIngestionRunId: RUN_A,
  })
  assert.equal(first.diagnostics.cohortSelected, 70)
  assert.equal(first.diagnostics.fairRemainderSelected, 30)
  assert.equal(first.diagnostics.unchecked, 100)
  database.markChecked(first.articleIds, '2026-08-05T00:00:00Z')

  const second = await selectSuggestPool(database, {
    limit: 100,
    preferredIngestionRunId: RUN_A,
  })
  const remainingCohort = second.metadata
    .filter((row) => row.ingestion_run_id === RUN_A)
    .slice(0, 53)
  assert.equal(remainingCohort.length, 53)
  assert.ok(remainingCohort.every((row) => row.suggestion_last_checked_at === null))
  assert.equal(second.diagnostics.unchecked, 83)
  assert.equal(second.diagnostics.rechecked, 17)
  database.markChecked(second.articleIds, '2026-08-05T01:00:00Z')

  const third = await selectSuggestPool(database, {
    limit: 100,
    preferredIngestionRunId: RUN_A,
  })
  assert.equal(third.diagnostics.cohortSelected, 70)
  assert.equal(third.diagnostics.fairRemainderSelected, 30)
  assert.ok(third.diagnostics.rechecked > 0)
  assert.ok(third.diagnostics.origin.rss < 100)
})

test('limits 100/120/200 preserve entitlement, uniqueness, and bounded size', async () => {
  for (const limit of [100, 120, 200]) {
    const result = await selectSuggestPool(fixture(), {
      limit,
      preferredIngestionRunId: RUN_A,
    })
    assert.equal(result.articleIds.length, limit)
    assert.equal(new Set(result.articleIds).size, limit)
    assert.equal(result.diagnostics.cohortSelected, Math.min(123, Math.ceil(limit * 0.7)))
    assert.ok(result.diagnostics.publication.null < result.articleIds.length)
    assert.ok(Math.max(...Object.values(result.diagnostics.source)) < result.articleIds.length)
  }
})

test('new correspondent-only run receives entitlement without starving RSS backlog', async () => {
  const database = fixture()
  database.rows.push(...Array.from({ length: 20 }, (_, index) =>
    article(`new-corr-${index}`, {
      runId: RUN_B,
      origin: 'correspondent',
      source: index % 4,
      fetchedOffset: 23,
    })
  ))
  const result = await selectSuggestPool(database, {
    limit: 100,
    preferredIngestionRunId: RUN_B,
  })
  assert.equal(result.diagnostics.resolvedIngestionRunId, RUN_B)
  assert.equal(result.diagnostics.cohortSelected, 20)
  assert.ok((result.diagnostics.origin.rss ?? 0) > 0)
  assert.ok((result.diagnostics.origin.correspondent ?? 0) >= 20)
})

test('fair query excludes a large current cohort before applying its DB limit', async () => {
  const currentCohort = Array.from({ length: 200 }, (_, index) => {
    const result = article(`large-cohort-${String(index).padStart(3, '0')}`, {
      runId: RUN_A,
      source: index % 10,
      published: true,
    })
    result.published_at = '2026-08-05T12:00:00Z'
    result.fetched_at = `2026-08-05T12:${String(index % 60).padStart(2, '0')}:00Z`
    return result
  })
  const backlog = Array.from({ length: 100 }, (_, index) => {
    const result = article(`deep-backlog-${String(index).padStart(3, '0')}`, {
      source: index % 10,
      published: true,
    })
    result.published_at = '2026-08-03T12:00:00Z'
    result.fetched_at = `2026-08-04T12:${String(index % 60).padStart(2, '0')}:00Z`
    return result
  })
  const selection = await selectSuggestPool(
    new FakeSupabase([...currentCohort, ...backlog]),
    { limit: 100, preferredIngestionRunId: RUN_A },
  )

  assert.equal(selection.articleIds.length, 100)
  assert.equal(selection.diagnostics.cohortSelected, 70)
  assert.equal(selection.diagnostics.fairRemainderSelected, 30)
  assert.equal(
    selection.metadata.filter((row) => row.ingestion_run_id === RUN_A).length,
    70,
  )
  assert.equal(
    selection.metadata.filter((row) => row.ingestion_run_id === null).length,
    30,
  )
})

test('D-original gives the newest correspondent remainder cohort weight 3', async () => {
  const database = fixture()
  database.rows.push(...Array.from({ length: 10 }, (_, index) => {
    const result = article(`current-corr-${index}`, {
      runId: RUN_B,
      origin: 'correspondent',
      source: index % 4,
      published: index % 2 === 0,
    })
    result.fetched_at = '2026-08-04T23:59:00Z'
    return result
  }))

  const selection = await selectSuggestPool(database, {
    limit: 100,
    preferredIngestionRunId: RUN_A,
  })

  assert.equal(selection.diagnostics.cohortSelected, 70)
  assert.equal(
    selection.metadata.filter((row) => row.ingestion_run_id === RUN_B).length,
    10,
  )
})

test('missing or malformed preferred run safely falls back to latest eligible run', async () => {
  const database = fixture()
  const latest = article('latest', {
    runId: RUN_B,
    origin: 'correspondent',
    fetchedOffset: 23,
  })
  latest.fetched_at = '2026-08-05T00:00:00Z'
  database.rows.push(latest)
  for (const preferred of ['not-a-uuid', '30000000-0000-4000-8000-000000000003']) {
    const result = await selectSuggestPool(database, {
      limit: 100,
      preferredIngestionRunId: preferred,
    })
    assert.equal(result.diagnostics.resolvedIngestionRunId, RUN_B)
    assert.equal(result.diagnostics.invalidPreferredIngestionRunId, true)
  }
})

test('legacy feature flag keeps the previous published-at selector available', async () => {
  const result = await selectSuggestPool(fixture(), {
    limit: 100,
    preferredIngestionRunId: RUN_A,
    policy: 'legacy_published_at',
  })
  assert.equal(result.diagnostics.policy, 'legacy_published_at')
  assert.equal(result.articleIds.length, 100)
  assert.equal(result.diagnostics.cohortSelected, 0)
})
