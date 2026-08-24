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

test('validator accepts flat inline arrays with more than ten tokens', () => {
  const content = Array.from({ length: 12 }, (_, index) => ({ type: 'text' as const, text: String(index) }))
  assert.equal(validateArticleBlockDocument({ version: 1, blocks: [{ type: 'paragraph', content }] }).ok, true)
})

test('validator accepts inline nesting depth 8 and rejects depth greater than 8', () => {
  const nested = (depth: number): unknown => depth === 0
    ? { type: 'text', text: '경계' }
    : { type: 'strong', content: [nested(depth - 1)] }
  assert.equal(validateArticleBlockDocument({ version: 1, blocks: [{ type: 'paragraph', content: [nested(8)] }] }).ok, true)
  assert.equal(validateArticleBlockDocument({ version: 1, blocks: [{ type: 'paragraph', content: [nested(9)] }] }).ok, false)
})

test('HTML-like unsupported input is retained as safe paragraph text', () => {
  const document = importMarkdownDocument('<script>alert(1)</script><b>원고</b>')
  assert.equal(document.blocks[0].type, 'paragraph')
  assert.match(projectBlocksToContent(document), /alert\(1\).*원고/)
  assert.doesNotMatch(projectBlocksToContent(document), /<[^>]+>/)
})

test('행사 정보 Markdown fixture keeps strong labels, list structure, and link semantics', () => {
  const markdown = [
    '## 행사 정보',
    '',
    '- **행사명**: TRICO',
    '- **일정**: 2026년 9월 11일 ~ 9월 13일',
    '- **장소**: 하이원리조트 밸리허브, 강원 정선',
    '- **티켓**: 일반 3일권 79,000원',
    '- **예매처**: Interpark, Resident Advisor',
    '- **인스타그램**: [https://www.instagram.com/tricofestival](https://www.instagram.com/tricofestival)',
  ].join('\n')
  const document = importMarkdownDocument(markdown)
  assert.deepEqual(document.blocks.map((block) => block.type), ['heading', 'list'])
  const list = document.blocks[1]
  assert.equal(list.type, 'list')
  if (list.type !== 'list') return
  assert.equal(list.ordered, false)
  assert.equal(list.items.length, 6)
  assert.ok(list.items.every((item) => item[0]?.type === 'strong'))
  assert.ok(list.items[5].some((inline) => inline.type === 'link' && inline.href === 'https://www.instagram.com/tricofestival'))
  const roundTrip = importMarkdownDocument(projectBlocksToContent(document))
  assert.deepEqual(roundTrip, document)
  const plain = blocksToPlainText(document)
  assert.doesNotMatch(plain, /\*\*|https?:\/\//)
})

test('strong, emphasis, link, and attribution parse with attribution precedence', () => {
  const document = importMarkdownDocument('**굵게**와 *기울임*, [링크](https://example.com)\n\n*출처: [원문 보기](https://example.com/story)*')
  assert.deepEqual(document.blocks.map((block) => block.type), ['paragraph', 'attribution'])
  const paragraph = document.blocks[0]
  assert.equal(paragraph.type, 'paragraph')
  if (paragraph.type === 'paragraph') assert.deepEqual(paragraph.content.map((inline) => inline.type), ['strong', 'text', 'emphasis', 'text', 'link'])
})
