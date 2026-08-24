import assert from 'node:assert/strict'
import test from 'node:test'
import { createEditorialDraft, saveEditorialArticle } from '@/lib/editorial-article-service'

const input = {
  title: '수동 기사 제목', category: '뉴스', genre: 'edm',
  slug: null, coverImageMode: 'none' as const, imageUrl: null, coverImagePath: null,
  contentBlocks: { version: 1 as const, blocks: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: '본문' }] }] },
}

test('manual article creation always inserts an unpublished draft with projection', async () => {
  let payload: Record<string, unknown> = {}
  await createEditorialDraft(input, async (value) => {
    payload = value
    return { data: { id: 'draft' }, error: null }
  })
  assert.equal(payload.published, false)
  assert.equal(payload.content, '본문')
  assert.deepEqual(payload.content_blocks, input.contentBlocks)
  assert.equal(payload.cover_image_mode, 'none')
  assert.equal(payload.image_url, null)
  assert.equal(payload.cover_image_path, null)
  assert.equal(payload.cluster_id, null)
})

test('draft save writes blocks and projection without deploy', async () => {
  let deploys = 0
  let payload: Record<string, unknown> = {}
  await saveEditorialArticle({ ...input, id: 'draft', published: false }, {
    update: async (value) => { payload = value; return { data: { id: 'draft' }, error: null } },
    triggerDeploy: async () => { deploys++ },
  })
  assert.equal(payload.content, '본문')
  assert.equal(deploys, 0)
})

test('published save triggers the existing deploy boundary exactly once', async () => {
  let deploys = 0
  await saveEditorialArticle({ ...input, id: 'published', published: true }, {
    update: async () => ({ data: { id: 'published' }, error: null }),
    triggerDeploy: async () => { deploys++ },
  })
  assert.equal(deploys, 1)
})
