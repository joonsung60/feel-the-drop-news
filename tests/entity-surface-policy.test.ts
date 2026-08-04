import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildEntityIndex,
  buildPairClusters,
  loadEntityDictionary,
} from '../lib/suggest/entity-index'
import { RawArticle } from '../lib/suggest/types'

const dictionary = loadEntityDictionary()
assert.ok(dictionary)

function raw(id: string, title: string, content = ''): RawArticle {
  return {
    id,
    title,
    content,
    url: `https://example.com/${id}`,
    source_id: null,
    published_at: '2026-07-28T00:00:00Z',
  }
}

function matches(title: string, content = ''): Set<string> {
  const article = raw('one', title, content)
  return buildEntityIndex([article], dictionary!).articleEntities.get(article.id) ?? new Set()
}

test('plain revealed verbs do not match Revealed Recordings', () => {
  for (const title of [
    'The festival has revealed its lineup',
    'They revealed a new schedule',
    'The dates were revealed yesterday',
    'The label has revealed its lineup',
    'The record label revealed the festival schedule',
    'The label revealed dates yesterday',
    'Dates were revealed by the label',
  ]) {
    assert.equal(matches(title).has('Revealed Recordings'), false, title)
  }
})

test('canonical and contextual Revealed references match', () => {
  for (const title of [
    'Released on Revealed',
    'Released via the Revealed label',
    'Signed to the Revealed label',
    'Revealed label announces a release',
    'Revealed Records announces a release',
    'Revealed Recordings announces a release',
  ]) {
    assert.equal(matches(title).has('Revealed Recordings'), true, title)
  }
})

test('other strong entities keep existing matching behavior', () => {
  assert.equal(matches('Skrillex announces a show').has('Skrillex'), true)
})

test('ambiguous common-word surfaces require specific entity context', () => {
  const cases: Array<[string, string, boolean]> = [
    ['Detroit techno pioneer John Collins', 'Pioneer DJ', false],
    ['Rusko is a dubstep pioneer', 'Pioneer DJ', false],
    ['Pioneer DJ launches a controller', 'Pioneer DJ', true],
    ['Pioneer CDJ-3000 announced', 'Pioneer DJ', true],
    ['a broad spectrum of dance music', 'Spectrum Dance Music Festival', false],
    ['Spectrum Dance Music Festival announces dates', 'Spectrum Dance Music Festival', true],
    ['a party on the beach', 'THE BEACH', false],
    ['at the beach', 'THE BEACH', false],
    ['THE BEACH Festival announces its lineup', 'THE BEACH', true],
    ['disclosure of the lineup', 'Disclosure', false],
    ['Disclosure release a new single', 'Disclosure', true],
    ['DJ duo Disclosure announces a tour', 'Disclosure', true],
  ]
  for (const [title, canonical, expected] of cases) {
    assert.equal(matches(title).has(canonical), expected, title)
  }
})

test('ambiguous surface alone cannot create a suggestion graph edge', () => {
  const articles = [
    raw('a', 'The label has revealed its lineup'),
    raw('b', 'The record label revealed the festival schedule'),
  ]
  const { articleEntities, entityArticles } = buildEntityIndex(articles, dictionary!)
  assert.equal(articleEntities.get('a')?.has('Revealed Recordings'), false)
  assert.equal(articleEntities.get('b')?.has('Revealed Recordings'), false)
  assert.equal(entityArticles.has('Revealed Recordings'), false)
  assert.deepEqual(
    buildPairClusters(articles, articleEntities, entityArticles, dictionary!),
    [],
  )
})

test('broad Bandcamp surface is supporting-only', () => {
  const article = raw('bandcamp', 'The Best Punk on Bandcamp, July 2026')
  const index = buildEntityIndex([article], dictionary!)
  assert.equal(index.articleEntities.get(article.id)?.has('Bandcamp'), false)
  assert.equal(index.articleSupportingEntities.get(article.id)?.has('Bandcamp'), true)
})

test('Better and ADVANCED require artist context', () => {
  for (const title of [
    'Andrew Chow, better known as DJ Wiz, has died',
    'Tools for better production decisions',
    'Aventon riders develop advanced skillsets',
    'Advanced plant-powered biotechnology',
  ]) {
    assert.equal(matches(title).has('Better'), false, title)
    assert.equal(matches(title).has('ADVANCED'), false, title)
  }
  for (const [title, canonical] of [
    ['DJ Better performs a new set', 'Better'],
    ['Better DJ set announced', 'Better'],
    ['DJ ADVANCED releases a remix', 'ADVANCED'],
    ['ADVANCED producer announces a track', 'ADVANCED'],
  ]) {
    assert.equal(matches(title).has(canonical), true, title)
  }
})
