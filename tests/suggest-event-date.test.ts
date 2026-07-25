import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canMergeByEventDate,
  hasEventDateConflict,
  knownEventDates,
} from '../lib/suggest/event-date'
import { buildPairClusters } from '../lib/suggest/entity-index'
import { mergeNormalizedSuggestions } from '../lib/suggest/merge'
import { normalizeSuggestion } from '../lib/suggest/normalize'
import { buildClusterPrompt, buildSingleGroupPrompt } from '../lib/suggest/prompts'
import { RawArticle, SuggestionWithArticles } from '../lib/suggest/types'

function article(id: string, event_date: string | null): RawArticle {
  return {
    id,
    title: `Shared Event ${id}`,
    content: 'Shared artist announces an electronic music event.',
    url: `https://example.com/${id}`,
    source_id: null,
    published_at: '2026-07-25T00:00:00Z',
    event_date,
  }
}

function suggestion(id: string, raw: RawArticle): SuggestionWithArticles {
  return {
    topic: `토픽 ${id}`,
    keywords: ['Shared Artist', 'Shared Event'],
    articleIds: [id],
    commonEntities: ['Shared Artist'],
    cohesionScore: 80,
    articles: [{ id, title: raw.title, url: raw.url }],
  }
}

test('same known event dates can merge', () => {
  const articles = [article('a', '2026-08-01'), article('b', '2026-08-01')]
  assert.equal(canMergeByEventDate(['a'], ['b'], articles), true)
})

test('different known event dates cannot merge', () => {
  const articles = [article('a', '2026-07-31'), article('b', '2026-08-01')]
  assert.equal(canMergeByEventDate(['a'], ['b'], articles), false)
})

test('known and null event dates can merge', () => {
  const articles = [article('a', '2026-08-01'), article('b', null)]
  assert.equal(canMergeByEventDate(['a'], ['b'], articles), true)
})

test('two null event dates can merge', () => {
  const articles = [article('a', null), article('b', null)]
  assert.equal(canMergeByEventDate(['a'], ['b'], articles), true)
})

test('normalization rejects one LLM suggestion containing conflicting dates', () => {
  const articles = [article('a', '2026-07-31'), article('b', '2026-08-01')]
  const meta = new Map(articles.map((raw) => [
    raw.id,
    { id: raw.id, title: raw.title, url: raw.url },
  ]))
  const normalized = normalizeSuggestion({
    topic: '서로 다른 행사',
    keywords: ['Shared Artist'],
    commonEntities: ['Shared Artist'],
    articleIds: ['a', 'b'],
  }, new Set(['a', 'b']), meta, articles)
  assert.equal(normalized, null)
  assert.equal(hasEventDateConflict(['a', 'b'], articles), true)
  assert.deepEqual(knownEventDates(['a', 'b'], articles), ['2026-07-31', '2026-08-01'])
})

test('merge keeps entity-matched suggestions separate when dates differ', () => {
  const articles = [article('a', '2026-07-31'), article('b', '2026-08-01')]
  assert.equal(
    mergeNormalizedSuggestions(
      [suggestion('a', articles[0]), suggestion('b', articles[1])],
      articles,
    ).length,
    2,
  )
})

test('merge preserves existing behavior when dates match', () => {
  const articles = [article('a', '2026-08-01'), article('b', '2026-08-01')]
  const merged = mergeNormalizedSuggestions(
    [suggestion('a', articles[0]), suggestion('b', articles[1])],
    articles,
  )
  assert.equal(merged.length, 1)
  assert.deepEqual(new Set(merged[0].articleIds), new Set(['a', 'b']))
})

test('cluster prompt includes known and unknown event dates', () => {
  const prompt = buildClusterPrompt([
    article('a', '2026-08-01'),
    article('b', null),
  ])
  assert.match(prompt, /행사\/발매일: 2026-08-01/)
  assert.match(prompt, /행사\/발매일: 불명/)
  assert.match(prompt, /모두 알려져 있고 서로 다르면/)

  const extendedPrompt = buildSingleGroupPrompt([
    article('a', '2026-08-01'),
    article('b', null),
  ], 'Shared Artist')
  assert.match(extendedPrompt, /행사\/발매일: 2026-08-01/)
  assert.match(extendedPrompt, /행사\/발매일: 불명/)
  assert.match(extendedPrompt, /모두 알려져 있고 서로 다르면/)
})

test('pair clustering does not create an edge for different known dates', () => {
  const articles = [article('a', '2026-07-31'), article('b', '2026-08-01')]
  const articleEntities = new Map([
    ['a', new Set(['Shared Artist', 'Shared Event'])],
    ['b', new Set(['Shared Artist', 'Shared Event'])],
  ])
  const entityArticles = new Map([
    ['Shared Artist', new Set(['a', 'b'])],
    ['Shared Event', new Set(['a', 'b'])],
  ])
  const dict = [
    { canonical: 'Shared Artist', surfaces: ['shared artist'], weight: 1 },
    { canonical: 'Shared Event', surfaces: ['shared event'], weight: 1 },
  ]
  assert.deepEqual(buildPairClusters(articles, articleEntities, entityArticles, dict), [])
})

test('D1 + null and D2 + null suggestions cannot merge', () => {
  const articles = [
    article('d1', '2026-07-31'),
    article('n1', null),
    article('d2', '2026-08-01'),
    article('n2', null),
  ]
  const left = {
    ...suggestion('d1', articles[0]),
    articleIds: ['d1', 'n1'],
    articles: [articles[0], articles[1]].map(({ id, title, url }) => ({ id, title, url })),
  }
  const right = {
    ...suggestion('d2', articles[2]),
    articleIds: ['d2', 'n2'],
    articles: [articles[2], articles[3]].map(({ id, title, url }) => ({ id, title, url })),
  }
  assert.equal(mergeNormalizedSuggestions([left, right], articles).length, 2)
})
