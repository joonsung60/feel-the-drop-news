import assert from 'node:assert/strict'
import test from 'node:test'
import {
  completedSuggest2ArticleIds,
  excludeCurrentFreshCohorts,
  orderSuggest2Groups,
  selectSuggest2EntityArticles,
  suggest2GroupLastCheckedAt,
  type Suggest2Group,
} from '../lib/suggest/backlog-selection'
import { buildPairClusters } from '../lib/suggest/entity-index'
import type { EntityEntry, RawArticle } from '../lib/suggest/types'

const NOW = new Date('2026-08-09T00:00:00Z')

function article(
  id: string,
  options: Partial<RawArticle> = {},
): RawArticle {
  return {
    id,
    title: `Shared story ${id}`,
    content: '',
    url: `https://example.com/${id}`,
    source_id: options.source_id ?? 'source-a',
    origin: options.origin ?? 'rss',
    published_at: options.published_at ?? '2026-08-08T00:00:00Z',
    fetched_at: options.fetched_at ?? '2026-08-08T01:00:00Z',
    suggestion_last_checked_at: options.suggestion_last_checked_at ?? null,
    suggest2_last_checked_at: options.suggest2_last_checked_at ?? null,
    ingestion_run_id: options.ingestion_run_id ?? null,
    ingestion_source: options.ingestion_source ?? null,
  }
}

const DICT: EntityEntry[] = [{
  canonical: 'Shared', surfaces: ['Shared'], weight: 1, role: 'qualifying',
}]

test('pair clusters are built from the whole backlog before the top-group limit', () => {
  const articles = [article('pair-a'), article('pair-b'), article('singleton')]
  const articleEntities = new Map(articles.map((item) => [item.id, new Set(['Shared'])]))
  const entityArticles = new Map([['Shared', new Set(articles.map(({ id }) => id))]])
  const groups = buildPairClusters(articles, articleEntities, entityArticles, DICT, {
    entityArticleSelector: (items, limit) =>
      selectSuggest2EntityArticles(items, limit, NOW),
  })
  assert.ok(groups.some((group) =>
    group.articleIds.includes('pair-a') && group.articleIds.includes('pair-b')
  ))
})

test('group ordering preserves origin/source/age diversity after unchecked priority', () => {
  const articles = [
    article('rss-new', { source_id: 'rss-1' }),
    article('corr-new', {
      origin: 'correspondent', source_id: null, ingestion_source: 'corr:one',
    }),
    article('legacy-old', {
      origin: null, source_id: null, published_at: '2026-05-01T00:00:00Z',
    }),
  ]
  const groups: Suggest2Group[] = articles.map((item, index) => ({
    entity: `entity-${index}`, articleIds: [item.id], weightSum: 10 - index,
  }))
  const ordered = orderSuggest2Groups(groups, articles, NOW)
  assert.deepEqual(new Set(ordered.slice(0, 3).map((group) => group.articleIds[0])),
    new Set(['rss-new', 'corr-new', 'legacy-old']))
})

test('only successfully approved or rejected groups become Suggest 2 checked', () => {
  assert.deepEqual(completedSuggest2ArticleIds([
    { articleIds: ['approved-a', 'shared'], outcome: 'approved' },
    { articleIds: ['rejected-a'], outcome: 'rejected' },
    { articleIds: ['timeout-a', 'shared-failed'], outcome: 'failed' },
  ]), ['approved-a', 'shared', 'rejected-a'])
})

test('Suggest 1 checked state does not affect Suggest 2 ordering', () => {
  const groups = [
    { entity: 'a', articleIds: ['a'], weightSum: 2 },
    { entity: 'b', articleIds: ['b'], weightSum: 1 },
  ]
  const baseline = [article('a'), article('b')]
  const changed = [
    article('a', { suggestion_last_checked_at: '2026-08-09T00:00:00Z' }),
    article('b'),
  ]
  assert.deepEqual(
    orderSuggest2Groups(groups, baseline, NOW),
    orderSuggest2Groups(groups, changed, NOW),
  )
})

test('checked top 30 groups move behind a remaining unchecked group', () => {
  const articles = Array.from({ length: 31 }, (_, index) => article(`article-${index}`))
  const groups = articles.map((item, index) => ({
    entity: `entity-${index}`, articleIds: [item.id], weightSum: 100 - index,
  }))
  const first = orderSuggest2Groups(groups, articles, NOW).slice(0, 30)
  const checked = new Set(first.flatMap((group) => group.articleIds))
  const after = articles.map((item) => checked.has(item.id)
    ? { ...item, suggest2_last_checked_at: NOW.toISOString() }
    : item)
  const second = orderSuggest2Groups(groups, after, NOW).slice(0, 30)
  assert.equal(second[0].articleIds[0], 'article-30')
  assert.notDeepEqual(second.map((group) => group.entity), first.map((group) => group.entity))
})

test('qualifying singleton remains in backlog but is absent from pair-cluster LLM input', () => {
  const articles = [article('paired-a'), article('paired-b'), article('singleton')]
  const articleEntities = new Map([
    ['paired-a', new Set(['Shared'])],
    ['paired-b', new Set(['Shared'])],
    ['singleton', new Set(['Singleton'])],
  ])
  const entityArticles = new Map([
    ['Shared', new Set(['paired-a', 'paired-b'])],
    ['Singleton', new Set(['singleton'])],
  ])
  const groups = buildPairClusters(articles, articleEntities, entityArticles, [
    ...DICT,
    { canonical: 'Singleton', surfaces: ['Singleton'], weight: 1, role: 'qualifying' },
  ])
  assert.equal(articles.some(({ id }) => id === 'singleton'), true)
  assert.equal(groups.some((group) => group.articleIds.includes('singleton')), false)
})

test('current explicit RSS and fresh correspondent cohorts are excluded from backlog', () => {
  const rows = [
    article('rss-fresh', { ingestion_run_id: 'rss-run' }),
    article('corr-fresh', {
      origin: 'correspondent', source_id: null, ingestion_run_id: 'corr-run',
      ingestion_source: 'corr:one',
    }),
    article('legacy'),
  ]
  const result = excludeCurrentFreshCohorts(rows, NOW)
  assert.deepEqual(result.backlog.map(({ id }) => id), ['legacy'])
  assert.deepEqual(new Set(result.excludedRunIds), new Set(['rss-run', 'corr-run']))
})

test('entity cap selection preserves unchecked source and age diversity', () => {
  const rows = Array.from({ length: 30 }, (_, index) => article(`cap-${index}`, {
    source_id: `source-${index % 5}`,
    published_at: index % 3 === 0
      ? '2026-08-08T00:00:00Z'
      : index % 3 === 1 ? '2026-07-20T00:00:00Z' : '2026-06-01T00:00:00Z',
    suggest2_last_checked_at: index < 5 ? NOW.toISOString() : null,
  }))
  const selected = selectSuggest2EntityArticles(rows, 15, NOW)
  assert.equal(selected.length, 15)
  assert.ok(selected.every((item) => !item.suggest2_last_checked_at))
  assert.ok(new Set(selected.map((item) => item.source_id)).size > 1)
  assert.ok(new Set(selected.map((item) => item.published_at)).size > 1)
})

test('group cursor rotates 60 same-queue groups across four runs', () => {
  const articles = Array.from({ length: 60 }, (_, index) =>
    article(`lru-${String(index).padStart(2, '0')}`)
  )
  const groups = articles.map((item) => ({
    entity: 'same-entity', articleIds: [item.id], weightSum: 1,
  }))
  const update = (ids: Set<string>, checkedAt: string) => {
    for (const item of articles) {
      if (ids.has(item.id)) item.suggest2_last_checked_at = checkedAt
    }
  }
  const first = orderSuggest2Groups(groups, articles, NOW).slice(0, 30)
  const firstIds = new Set(first.flatMap((group) => group.articleIds))
  update(firstIds, '2026-08-09T01:00:00Z')
  const second = orderSuggest2Groups(groups, articles, NOW).slice(0, 30)
  const secondIds = new Set(second.flatMap((group) => group.articleIds))
  assert.equal([...secondIds].some((id) => firstIds.has(id)), false)
  update(secondIds, '2026-08-09T02:00:00Z')
  const thirdIds = new Set(orderSuggest2Groups(groups, articles, NOW)
    .slice(0, 30).flatMap((group) => group.articleIds))
  assert.deepEqual(thirdIds, firstIds)
  update(thirdIds, '2026-08-09T03:00:00Z')
  const fourthIds = new Set(orderSuggest2Groups(groups, articles, NOW)
    .slice(0, 30).flatMap((group) => group.articleIds))
  assert.deepEqual(fourthIds, secondIds)
})

test('entity article cursor rotates two checked sets of 15', () => {
  const rows = Array.from({ length: 30 }, (_, index) => article(`entity-lru-${index}`, {
    suggest2_last_checked_at: '2026-08-08T00:00:00Z',
  }))
  const first = selectSuggest2EntityArticles(rows, 15, NOW)
  const firstIds = new Set(first.map(({ id }) => id))
  for (const item of rows) {
    if (firstIds.has(item.id)) item.suggest2_last_checked_at = '2026-08-09T01:00:00Z'
  }
  const second = selectSuggest2EntityArticles(rows, 15, NOW)
  assert.equal(second.some(({ id }) => firstIds.has(id)), false)
})

test('group last-checked uses the newest article timestamp conservatively', () => {
  const rows = [
    article('old', { suggest2_last_checked_at: '2026-08-08T00:00:00Z' }),
    article('new', { suggest2_last_checked_at: '2026-08-09T00:00:00Z' }),
  ]
  assert.equal(suggest2GroupLastCheckedAt(
    { entity: 'mixed', articleIds: ['old', 'new'], weightSum: 1 },
    new Map(rows.map((item) => [item.id, item])),
  ), '2026-08-09T00:00:00Z')
})

test('correspondent freshness ignores same-run rows from other origins', () => {
  const rows = [
    article('corr-old', {
      origin: 'correspondent', source_id: null, ingestion_run_id: 'mixed-run',
      ingestion_source: 'corr:one', fetched_at: '2026-08-01T00:00:00Z',
    }),
    article('url-new', {
      origin: 'url', source_id: null, ingestion_run_id: 'mixed-run',
      fetched_at: '2026-08-08T23:00:00Z',
    }),
  ]
  const result = excludeCurrentFreshCohorts(rows, NOW)
  assert.deepEqual(result.excludedRunIds, [])
  assert.deepEqual(result.backlog.map(({ id }) => id), ['corr-old', 'url-new'])
})

test('fresh cohort exclusion does not remove other-origin rows sharing a run ID', () => {
  const rows = [
    article('rss-fresh', { ingestion_run_id: 'shared-run' }),
    article('url-shared', {
      origin: 'url', source_id: null, ingestion_run_id: 'shared-run',
    }),
  ]
  const result = excludeCurrentFreshCohorts(rows, NOW)
  assert.deepEqual(result.backlog.map(({ id }) => id), ['url-shared'])
})
