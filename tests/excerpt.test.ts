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

test('removes public-summary Markdown decoration without changing legacy prose', () => {
  const markdown = [
    '## 소제목',
    '- 첫 항목',
    '> 인용문',
    '[표시 문구](https://example.com/path)',
    '![이미지](https://example.com/image.jpg)',
    '*출처 문구*',
  ].join('\n')

  assert.equal(
    createArticleExcerpt(markdown),
    '소제목 첫 항목 인용문 표시 문구 출처 문구'
  )
  assert.equal(createArticleExcerpt('기존 일반 본문입니다. 둘째 문장입니다.'), '기존 일반 본문입니다. 둘째 문장입니다.')
})

test('uses valid blocks as the plain-text source for public summaries', () => {
  const blocks = {
    version: 1,
    blocks: [
      { type: 'heading', level: 2, content: [{ type: 'text', text: '블록 제목' }] },
      { type: 'paragraph', content: [{ type: 'link', text: '링크 문구', href: 'https://example.com' }] },
      { type: 'image', src: 'https://example.com/image.jpg', alt: '이미지 설명' },
    ],
  }
  assert.equal(
    createArticleExcerpt('stale legacy', 180, blocks),
    '블록 제목 링크 문구 이미지 설명'
  )
})
