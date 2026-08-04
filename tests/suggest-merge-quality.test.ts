import assert from 'node:assert/strict'
import test from 'node:test'
import { mergeNormalizedSuggestions } from '../lib/suggest/merge'
import type { RawArticle, SuggestionWithArticles } from '../lib/suggest/types'

function article(id: string, title: string): RawArticle {
  return {
    id,
    title,
    content: title,
    url: `https://example.com/${id}`,
    source_id: id,
    published_at: '2026-08-04T00:00:00Z',
  }
}

function suggestion(
  raw: RawArticle,
  topic: string,
  keywords: string[],
  commonEntities: string[],
): SuggestionWithArticles {
  return {
    topic,
    keywords,
    articleIds: [raw.id],
    commonEntities,
    cohesionScore: 80,
    articles: [{ id: raw.id, title: raw.title, url: raw.url }],
  }
}

function mergedCount(
  left: { title: string; topic: string; keywords: readonly string[]; entities: readonly string[] },
  right: { title: string; topic: string; keywords: readonly string[]; entities: readonly string[] },
) {
  const articles = [article('a', left.title), article('b', right.title)]
  return mergeNormalizedSuggestions([
    suggestion(articles[0], left.topic, [...left.keywords], [...left.entities]),
    suggestion(articles[1], right.topic, [...right.keywords], [...right.entities]),
  ], articles).length
}

test('keeps known same-story duplicate coverage merged', () => {
  const cases = [
    [
      { title: 'Fred again.. and LATIN MAFIA release 9 months & 50 hours', topic: 'Fred mixtape', keywords: ['9 months & 50 hours', 'LATIN MAFIA'], entities: ['Fred again..'] },
      { title: 'Fred again.. & LATIN MAFIA 9 months & 50 hours mixtape', topic: 'Fred mixtape', keywords: ['9 months & 50 hours', 'LATIN MAFIA'], entities: ['Fred again..'] },
    ],
    [
      { title: 'Kaskade announces ORIGIN// tour', topic: 'Kaskade ORIGIN', keywords: ['ORIGIN//', 'tour'], entities: ['Kaskade'] },
      { title: 'Kaskade brings ORIGIN // live show to four cities', topic: 'Kaskade ORIGIN', keywords: ['ORIGIN//', 'live show'], entities: ['Kaskade'] },
    ],
    [
      { title: 'Vintage Culture releases Think Too Much', topic: 'Think Too Much', keywords: ['Think Too Much', 'Nariman'], entities: ['Vintage Culture'] },
      { title: 'Vintage Culture reflects with Think Too Much', topic: 'Think Too Much', keywords: ['Think Too Much', 'Nariman'], entities: ['Vintage Culture'] },
    ],
    [
      { title: 'Ozora Festival ends early after two deaths', topic: 'Ozora deaths', keywords: ['two deaths', 'ends early'], entities: ['O.Z.O.R.A. Festival'] },
      { title: 'Ozora Festival terminated early following two deaths', topic: 'Ozora deaths', keywords: ['two deaths', 'ends early'], entities: ['O.Z.O.R.A. Festival'] },
    ],
  ] as const
  for (const [left, right] of cases) {
    assert.equal(mergedCount(left, right), 1, left.topic)
  }
})

test('separates known false merges with only broad entity or generic keywords', () => {
  const cases = [
    [
      { title: 'Tomorrowland official aftermovie', topic: 'Tomorrowland aftermovie', keywords: ['official aftermovie', 'Tomorrowland'], entities: ['Tomorrowland'] },
      { title: 'Aaron Hibell interview at Tomorrowland', topic: 'Aaron Hibell interview', keywords: ['Aaron Hibell', 'interview'], entities: ['Tomorrowland'] },
    ],
    [
      { title: 'Watch Tomorrowland sets from Martin Garrix and Hardwell artists', topic: 'Tomorrowland sets', keywords: ['Stage Set', 'artists'], entities: ['Tomorrowland'] },
      { title: 'Watch the Tomorrowland official aftermovie across 16 stages', topic: 'Tomorrowland aftermovie', keywords: ['official aftermovie', '16 stages'], entities: ['Tomorrowland'] },
    ],
    [
      { title: 'Roland JD-990 emulator JADE', topic: 'Roland JD-990', keywords: ['JD-990', 'JADE'], entities: ['Roland'] },
      { title: 'Roland GO:KEYS 3 Minion keyboard', topic: 'Roland GO:KEYS', keywords: ['GO:KEYS 3', 'Minion'], entities: ['Roland'] },
    ],
    [
      { title: 'Best Punk on Bandcamp July', topic: 'Bandcamp punk', keywords: ['punk', 'July 2026'], entities: ['Bandcamp'] },
      { title: 'sachi mirror Talking in a Different Way', topic: 'sachi mirror', keywords: ['sachi mirror', 'Talking in a Different Way'], entities: ['Bandcamp'] },
    ],
    [
      { title: 'Christian Hornbostel releases Eridanus single', topic: 'Eridanus', keywords: ['single', 'release'], entities: ['Christian Hornbostel'] },
      { title: 'Eliza Rose releases Kite single', topic: 'Kite', keywords: ['single', 'release'], entities: ['Eliza Rose'] },
    ],
    [
      { title: 'KAMAYA Festival announces Dixon lineup', topic: 'KAMAYA', keywords: ['festival', 'lineup'], entities: ['Dixon'] },
      { title: 'Eastern Electrics announces East End Dubs lineup', topic: 'Eastern Electrics', keywords: ['festival', 'lineup'], entities: ['East End Dubs'] },
    ],
  ] as const
  for (const [left, right] of cases) {
    assert.equal(mergedCount(left, right), 2, `${left.topic} / ${right.topic}`)
  }
})

test('merged commonEntities are the verified intersection', () => {
  const articles = [
    article('a', 'Shared Artist announces Story Key with Alpha'),
    article('b', 'Shared Artist confirms Story Key with Beta'),
  ]
  const merged = mergeNormalizedSuggestions([
    suggestion(articles[0], 'Story Key', ['Story Key'], ['Shared Artist', 'Alpha']),
    suggestion(articles[1], 'Story Key', ['Story Key'], ['Shared Artist', 'Beta']),
  ], articles)
  assert.equal(merged.length, 1)
  assert.deepEqual(merged[0].commonEntities, ['Shared Artist'])
})

test('failed post-merge cohesion preserves both original suggestions', () => {
  const articles = [
    article('a', 'First unrelated report'),
    article('b', 'Second unrelated report'),
  ]
  const originals = [
    suggestion(articles[0], 'First', ['Claimed Story Key'], ['Claimed Entity']),
    suggestion(articles[1], 'Second', ['Claimed Story Key'], ['Claimed Entity']),
  ]
  const merged = mergeNormalizedSuggestions(originals, articles)
  assert.deepEqual(merged, originals)
})

test('hallucinated shared keywords cannot merge unrelated grounded stories', () => {
  const cases = [
    [
      { title: 'Above & Beyond celebrate One Mix on Apple Music', topic: 'One Mix', keywords: ['One Mix', 'Spatial Audio'], entities: ['Above & Beyond'] },
      { title: 'Christian Hornbostel releases Eridanus', topic: 'Eridanus', keywords: ['Eridanus', 'Spatial Audio'], entities: ['Christian Hornbostel'] },
    ],
    [
      { title: 'Tomorrowland releases its official aftermovie', topic: 'Tomorrowland aftermovie', keywords: ['official aftermovie', 'Shared Festival Story'], entities: ['Tomorrowland'] },
      { title: 'Cale Anderson discusses Yemaya and folktronica', topic: 'Cale Anderson', keywords: ['Yemaya', 'Shared Festival Story'], entities: [] },
    ],
  ] as const
  for (const [left, right] of cases) {
    assert.equal(mergedCount(left, right), 2, `${left.topic} / ${right.topic}`)
  }
})

test('three grounded Ozora incident singletons merge into one suggestion', () => {
  const articles = [
    article('a', 'Two attendees die at Ozora Festival and the event ends early'),
    article('b', 'Nach zwei Todesfällen: Ozora Festival vorzeitig beendet'),
    article('c', 'Ozora Festival abruptly cancelled after two deaths'),
  ]
  const suggestions = articles.map((raw) => suggestion(
    raw,
    'Ozora Festival 사망 사고 및 조기 종료',
    ['Ozora Festival', 'two fatalities', 'early termination'],
    ['O.Z.O.R.A. Festival'],
  ))
  const merged = mergeNormalizedSuggestions(suggestions, articles)
  assert.equal(merged.length, 1)
  assert.deepEqual(new Set(merged[0].articleIds), new Set(['a', 'b', 'c']))
})
