import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blocksToPlainText,
  importMarkdownDocument,
  legacyContentToBlockDocument,
  projectBlocksToContent,
  validateArticleBlockDocument,
} from '@/lib/article-blocks'

test('legacy content converts paragraphs, attribution, and image without loss', () => {
  const content = '첫 문단\n\n![포스터](https://example.com/poster.jpg)\n\n*출처: [원문 보기](https://example.com/story)*'
  const document = legacyContentToBlockDocument(content)
  assert.deepEqual(document.blocks.map((block) => block.type), ['paragraph', 'image', 'attribution'])
  assert.equal(projectBlocksToContent(document), content)
})

test('supported Markdown imports and projects its major structure', () => {
  const markdown = [
    '## H2 제목', '### H3 제목', '[링크](https://example.com)가 있는 문단',
    '- 하나\n- 둘', '1. 첫째\n2. 둘째', '> 인용문',
  ].join('\n\n')
  const document = importMarkdownDocument(markdown)
  assert.deepEqual(document.blocks.map((block) => block.type), [
    'heading', 'heading', 'paragraph', 'list', 'list', 'blockquote',
  ])
  assert.equal(importMarkdownDocument(projectBlocksToContent(document)).blocks.length, 6)
  assert.match(blocksToPlainText(document), /링크가 있는 문단/)
})

test('validator rejects unsafe URLs, unknown blocks, malformed JSON, and non-H2/H3 headings', () => {
  assert.equal(validateArticleBlockDocument(null).ok, false)
  assert.equal(validateArticleBlockDocument({ version: 1, blocks: [{ type: 'video' }] }).ok, false)
  assert.equal(validateArticleBlockDocument({ version: 1, blocks: [{ type: 'heading', level: 1, content: [] }] }).ok, false)
  assert.equal(validateArticleBlockDocument({ version: 1, blocks: [{ type: 'image', src: 'javascript:alert(1)', alt: '' }] }).ok, false)
  assert.equal(validateArticleBlockDocument({ version: 1, blocks: [{ type: 'paragraph', content: [{ type: 'link', text: 'x', href: 'javascript:x' }] }] }).ok, false)
})

test('HTML-like unsupported input is retained as safe paragraph text', () => {
  const document = importMarkdownDocument('<script>alert(1)</script><b>원고</b>')
  assert.equal(document.blocks[0].type, 'paragraph')
  assert.match(projectBlocksToContent(document), /alert\(1\).*원고/)
  assert.doesNotMatch(projectBlocksToContent(document), /<[^>]+>/)
})
