import assert from 'node:assert/strict'
import test from 'node:test'
import { validateEditorialArticleInput } from '@/lib/editorial-article-input'

const valid = {
  title: '수동 기사 제목',
  category: '뉴스',
  genre: 'edm',
  slug: null,
  coverImageMode: 'none',
  showCoverInArticle: true,
  imageUrl: null,
  coverImagePath: null,
  contentBlocks: {
    version: 1,
    blocks: [{ type: 'paragraph', content: [{ type: 'text', text: '본문' }] }],
  },
}

test('editor input accepts only the explicit field set', () => {
  assert.equal(validateEditorialArticleInput(valid).ok, true)
  assert.equal(validateEditorialArticleInput({ ...valid, published: true }).ok, false)
  const missing = { ...valid } as Partial<typeof valid>
  delete missing.genre
  assert.equal(validateEditorialArticleInput(missing).ok, false)
})

test('editor input rejects malformed block documents', () => {
  assert.equal(validateEditorialArticleInput({
    ...valid,
    contentBlocks: { version: 1, blocks: [{ type: 'heading', level: 4, content: [] }] },
  }).ok, false)
})

test('editor input requires an explicit article cover visibility boolean', () => {
  assert.equal(validateEditorialArticleInput({ ...valid, showCoverInArticle: false }).ok, true)
  assert.equal(validateEditorialArticleInput({ ...valid, showCoverInArticle: null }).ok, false)
})
