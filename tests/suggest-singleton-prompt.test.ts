import assert from 'node:assert/strict'
import test from 'node:test'
import { isSingletonRawSuggestion } from '../lib/suggest/normalize'
import {
  SUGGEST_RESPONSE_FORMAT,
  buildClusterPrompt,
} from '../lib/suggest/prompts'
import type { RawArticle } from '../lib/suggest/types'

const article: RawArticle = {
  id: 'article-1',
  title: 'Example electronic music article',
  content: 'A producer announces a specific release.',
  url: 'https://example.com/article-1',
  source_id: null,
}

test('cluster prompt requires independent singleton suggestions and omits irrelevant articles', () => {
  const prompt = buildClusterPrompt([article])
  assert.match(prompt, /기사별로 독립적인 suggestion/)
  assert.match(prompt, /정확히 하나의 article ID/)
  assert.match(prompt, /서로 묶지 마세요/)
  assert.match(prompt, /관련 없는 기사는 suggestions 배열에서 생략/)
})

test('response schema permits exactly one article ID', () => {
  const articleIds = SUGGEST_RESPONSE_FORMAT.properties.suggestions.items.properties.articleIds
  assert.equal(articleIds.minItems, 1)
  assert.equal(articleIds.maxItems, 1)
})

test('raw suggestion singleton validator rejects zero or multiple IDs', () => {
  assert.equal(isSingletonRawSuggestion({ articleIds: ['article-1'] }), true)
  assert.equal(isSingletonRawSuggestion({ articleIds: [] }), false)
  assert.equal(isSingletonRawSuggestion({ articleIds: ['article-1', 'article-2'] }), false)
  assert.equal(isSingletonRawSuggestion({}), false)
})
