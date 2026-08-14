import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error The test runner loads the TypeScript source directly.
import { createArticleExcerpt } from '../lib/excerpt.ts'

test('removes Markdown images and keeps Markdown link text', () => {
  assert.equal(
    createArticleExcerpt('첫 문장 ![커버](https://example.com/cover.jpg) [원문 링크](https://example.com) 끝.'),
    '첫 문장 원문 링크 끝.'
  )
})

test('normalizes whitespace', () => {
  assert.equal(createArticleExcerpt('  첫째\n\n둘째\t 셋째  '), '첫째 둘째 셋째')
})

test('truncates near the requested length at a word boundary', () => {
  const excerpt = createArticleExcerpt('alpha '.repeat(40), 30)
  assert.equal(excerpt, 'alpha alpha alpha alpha alpha…')
  assert.ok(excerpt.length <= 31)
})

test('keeps short content unchanged', () => {
  assert.equal(createArticleExcerpt('짧은 본문'), '짧은 본문')
})
