import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error The test runner loads the TypeScript source directly.
import { cleanArticleText } from '../lib/article-extraction.ts'

test('stops before related posts content', () => {
  const content = [
    '¥ØU$UK€ ¥UK1MAT$U가 The Prodigy 트리뷰트 믹스를 공개했다.',
    'RELATED POSTS',
    'Skrillex全面参加、Naisha EP『911』リリース',
  ].join('\n')

  assert.equal(
    cleanArticleText(content),
    '¥ØU$UK€ ¥UK1MAT$U가 The Prodigy 트리뷰트 믹스를 공개했다.'
  )
})
