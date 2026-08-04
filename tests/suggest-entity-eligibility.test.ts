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

function danceExperienceArticle(id: string, title: string, content = ''): RawArticle {
  return {
    ...article(id, title, content),
    facts: {
      correspondent_gate: {
        decision: 'accepted',
        path: 'dance_experience',
        candidate_key: `candidate-${id}`,
      },
    },
  }
}

function normalizeOne(
  raw: RawArticle,
  validIds: Set<string>,
  qualifying: Map<string, Set<string>>,
) {
  return normalizeSuggestion({
    topic: '테스트 토픽',
    keywords: [raw.title],
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

test('accepted no-entity dance experiences enter LLM input without fallback quota', () => {
  const dance = danceExperienceArticle(
    'warehouse',
    'Public techno warehouse party',
    'DJ sets, an independent stage schedule, and public tickets are confirmed.',
  )
  const index = buildEntityIndex([dance], dictionary!)
  const partition = partitionArticlesByEntityRole(
    [dance],
    index.articleEntities,
    index.articleSupportingEntities,
  )
  assert.deepEqual(partition.danceExperience.map(({ id }) => id), ['warehouse'])
  assert.deepEqual(
    selectEligibleLlmInput(partition, 1, 0).input.map(({ id }) => id),
    ['warehouse'],
  )
})

test('dance approval requires persisted accepted decision and can override supporting-only venue', () => {
  const accepted = danceExperienceArticle(
    'coex-dance',
    'Independent public DJ stage at COEX THE PLATZ',
  )
  const unverified = {
    ...danceExperienceArticle('unverified', 'DJ performance candidate at COEX THE PLATZ'),
    facts: { correspondent_gate: { decision: 'needs_verification', path: 'dance_experience' } },
  } satisfies RawArticle
  const index = buildEntityIndex([accepted, unverified], dictionary!)
  const partition = partitionArticlesByEntityRole(
    [accepted, unverified],
    index.articleEntities,
    index.articleSupportingEntities,
  )
  assert.deepEqual(partition.danceExperience.map(({ id }) => id), ['coex-dance'])
  assert.deepEqual(partition.supportingOnly.map(({ id }) => id), ['unverified'])
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

test('DJ fallback excludes explicit hip-hop and turntablist context without harming EDM DJ recall', () => {
  assert.equal(hasExplicitEdmEvidence(article(
    'andrew',
    'Remembering Andrew Chow, the legendary turntablist who shaped Singapore’s hip-hop nightlife',
    'Better known as DJ Wiz, he played hip-hop and R&B.',
  )), false)
  assert.equal(hasExplicitEdmEvidence(article(
    'dance-dj',
    'Two children set a record as the youngest DJ duo',
  )), true)
  assert.equal(hasExplicitEdmEvidence(article(
    'djing',
    'Meta glasses make DJing point-of-view video possible',
  )), true)
})

test('synth fallback excludes a non-music vehicle metaphor without harming music coverage', () => {
  assert.equal(hasExplicitEdmEvidence(article(
    'aventon',
    'Aventon Current ADV Review: An Amazing eMTB That Hits The Sweet Spot',
    'The electric mountain bike market has become a little like the modular synth world.',
  )), false)
  assert.equal(hasExplicitEdmEvidence(article(
    'praana',
    'PRAANA Talk Insight Out, Presence, And Looking Inward',
    'The progressive house album uses glowing synth work and hypnotic grooves.',
  )), true)
  assert.equal(hasExplicitEdmEvidence(article(
    'hardware',
    'Best MIDI Controllers For Hybrid Studios',
    'A hardware synth or drum machine enters the setup.',
  )), true)
})

test('normalization uses canonical deterministic entities instead of LLM alias spelling', () => {
  const ozora = article(
    'ozora',
    'Two attendees die at Hungary’s Ozora Festival, event ends early',
  )
  const normalized = normalizeSuggestion({
    topic: 'Ozora Festival 조기 종료',
    keywords: ['tragic fatalities'],
    commonEntities: ['Ozora Festival'],
    articleIds: [ozora.id],
  }, new Set([ozora.id]), new Map([[ozora.id, {
    id: ozora.id,
    title: ozora.title,
    url: ozora.url,
  }]]), [ozora], new Map([[ozora.id, new Set(['O.Z.O.R.A. Festival'])]]))

  assert.deepEqual(normalized?.commonEntities, ['O.Z.O.R.A. Festival'])
})

test('normalization rejects a singleton whose LLM story belongs to another article', () => {
  const ozora = article(
    'ozora-shifted',
    'Ozora Festival ends early after two deaths',
  )
  const normalized = normalizeSuggestion({
    topic: 'Eastern Electrics 2026 라인업 발표',
    keywords: ['Eastern Electrics', 'East End Dubs', 'Joseph Capriati'],
    commonEntities: ['Eastern Electrics'],
    articleIds: [ozora.id],
  }, new Set([ozora.id]), new Map([[ozora.id, {
    id: ozora.id,
    title: ozora.title,
    url: ozora.url,
  }]]), [ozora], new Map([[ozora.id, new Set(['O.Z.O.R.A. Festival'])]]))

  assert.equal(normalized, null)
})

test('normalization permits Korean-only descriptions for a deterministically matched singleton', () => {
  const ozora = article(
    'ozora-korean',
    'Ozora Festival ends early after two deaths',
  )
  const normalized = normalizeSuggestion({
    topic: '오조라 페스티벌 사망 사고로 조기 종료',
    keywords: ['오조라 페스티벌', '사망 사고', '조기 종료'],
    commonEntities: ['오조라 페스티벌'],
    articleIds: [ozora.id],
  }, new Set([ozora.id]), new Map([[ozora.id, {
    id: ozora.id,
    title: ozora.title,
    url: ozora.url,
  }]]), [ozora], new Map([[ozora.id, new Set(['O.Z.O.R.A. Festival'])]]))

  assert.deepEqual(normalized?.commonEntities, ['O.Z.O.R.A. Festival'])
})
