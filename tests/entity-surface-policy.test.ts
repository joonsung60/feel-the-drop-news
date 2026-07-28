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
