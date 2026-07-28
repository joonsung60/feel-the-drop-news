import assert from 'node:assert/strict'
import test from 'node:test'
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
import { normalizeSuggestion } from '../lib/suggest/normalize'
import { rankAndTrim } from '../lib/suggest/rank'
import { RawArticle, SuggestionWithArticles } from '../lib/suggest/types'

const dictionary = loadEntityDictionary()
assert.ok(dictionary)

function article(id: string, title: string, content = ''): RawArticle {
  return {
    id,
    title,
    content,
    url: `https://example.com/${id}`,
    source_id: null,
    published_at: '2026-07-28T00:00:00Z',
  }
}

function normalizeOne(
  raw: RawArticle,
  validIds: Set<string>,
  qualifying: Map<string, Set<string>>,
) {
  return normalizeSuggestion({
    topic: '테스트 토픽',
    keywords: ['Specific Name'],
    commonEntities: ['COEX THE PLATZ', 'Carl Cox'],
    articleIds: [raw.id],
  }, validIds, new Map([[raw.id, {
    id: raw.id,
    title: raw.title,
    url: raw.url,
  }]]), [raw], qualifying)
}

test('supporting-only articles are distinct and never enter either LLM quota', () => {
  const home = article(
    'home',
    'HOUSE ARCHIVE: Home Digging Fair',
    'Lifestyle and interior brands exhibit at COEX THE PLATZ.',
  )
  const index = buildEntityIndex([home], dictionary!)
  const partition = partitionArticlesByEntityRole(
    [home],
    index.articleEntities,
    index.articleSupportingEntities,
  )
  assert.equal(index.articleEntities.get(home.id)?.size, 0)
  assert.deepEqual([...index.articleSupportingEntities.get(home.id)!], ['COEX THE PLATZ'])
  assert.deepEqual(partition.supportingOnly.map(({ id }) => id), ['home'])
  assert.equal(partition.notMatched.length, 0)
  assert.equal(selectEligibleLlmInput(partition, 120, 0.6).input.length, 0)
  assert.equal(normalizeOne(home, new Set(), index.articleEntities), null)
  assert.equal(
    normalizeSuggestion({
      topic: '우회 시도',
      keywords: ['Specific Name'],
      articleIds: [home.id],
    }, new Set(['different-batch-id']), new Map(), [home], index.articleEntities),
    null,
  )
})

test('qualifying entities retain articles while supporting venues add no authority', () => {
  const mixed = article('mixed', 'Carl Cox performs at COEX THE PLATZ')
  const womb = article('womb', 'WOMB announces a club night')
  const index = buildEntityIndex([mixed, womb], dictionary!)
  assert.deepEqual([...index.articleEntities.get('mixed')!], ['Carl Cox'])
  assert.deepEqual([...index.articleSupportingEntities.get('mixed')!], ['COEX THE PLATZ'])
  assert.deepEqual([...index.articleEntities.get('womb')!], ['WOMB'])
  assert.ok(normalizeOne(mixed, new Set(['mixed']), index.articleEntities))
})

test('supporting-only shared entities cannot create graph edges or weight', () => {
  const articles = [
    article('a', 'Home fair at COEX THE PLATZ'),
    article('b', 'Brand exhibition at COEX THE PLATZ'),
  ]
  const articleEntities = new Map([
    ['a', new Set(['COEX THE PLATZ'])],
    ['b', new Set(['COEX THE PLATZ'])],
  ])
  const entityArticles = new Map([
    ['COEX THE PLATZ', new Set(['a', 'b'])],
  ])
  assert.deepEqual(
    buildPairClusters(articles, articleEntities, entityArticles, [
      {
        canonical: 'COEX THE PLATZ',
        role: 'supporting',
        surfaces: ['coex the platz'],
        weight: 1,
      },
    ]),
    [],
  )
})

test('supporting entities add no rank bonus', () => {
  const raw = article('rank', 'An electronic music report')
  const base: SuggestionWithArticles = {
    topic: '기본 제안',
    keywords: ['Specific Name'],
    articleIds: ['rank'],
    commonEntities: [],
    cohesionScore: 0,
    articles: [{ id: raw.id, title: raw.title, url: raw.url }],
  }
  const supporting: SuggestionWithArticles = {
    ...base,
    topic: '장소 제안',
    commonEntities: ['COEX THE PLATZ'],
  }
  const coex = dictionary!.find(({ canonical }) => canonical === 'COEX THE PLATZ')
  assert.ok(coex)
  assert.deepEqual(rankAndTrim([base, supporting], [raw], [coex], 1), [base])
})

test('singleton cohesion cannot replace deterministic EDM eligibility', () => {
  const home = article('home', 'Home lifestyle fair', 'Interior brands and furniture.')
  const edm = article(
    'edm',
    'Independent scene report',
    'An electronic music producer performs a new techno set.',
  )
  assert.equal(hasExplicitEdmEvidence(home), false)
  assert.equal(hasExplicitEdmEvidence(edm), true)
  assert.equal(normalizeOne(home, new Set(['home']), new Map()), null)
  const normalized = normalizeOne(edm, new Set(['edm']), new Map())
  assert.ok(normalized)
  assert.equal(normalized.cohesionScore, 0)
})

test('generic discovery words do not count as explicit EDM evidence', () => {
  for (const text of [
    'Home fair at a venue',
    'House and lifestyle brand exhibition',
    'New pop album and single',
    'General club conference lineup',
  ]) {
    assert.equal(hasExplicitEdmEvidence(article(text, text)), false, text)
  }
})
