import assert from 'node:assert/strict'
import test from 'node:test'
import { validateMinimumPublishContent } from '../lib/article-publish-validation'

test('empty manual draft is rejected at publish time', () => {
  assert.deepEqual(validateMinimumPublishContent('   '), {
    status: 422,
    body: {
      code: 'ARTICLE_CONTENT_TOO_SHORT',
      error: '본문은 앞뒤 공백을 제거한 뒤 80자 이상이어야 게시할 수 있습니다.',
    },
  })
})

test('manual draft shorter than 80 trimmed characters is rejected', () => {
  assert.equal(validateMinimumPublishContent(`  ${'가'.repeat(79)}  `)?.body.code, 'ARTICLE_CONTENT_TOO_SHORT')
})

test('manual draft with 80 trimmed characters is ready for existing grounding checks', () => {
  assert.equal(validateMinimumPublishContent(`  ${'가'.repeat(80)}  `), null)
})
