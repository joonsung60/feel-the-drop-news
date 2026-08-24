import assert from 'node:assert/strict'
import test from 'node:test'
import { cleanupEditorialMediaWithReferences } from '@/lib/editorial-media-references'

const target = 'editorial/2026/08/11111111-1111-4111-8111-111111111111.png'
const other = 'editorial/2026/08/22222222-2222-4222-8222-222222222222.png'

test('reference lookup scans beyond 1,000 articles before deleting unreferenced media', async () => {
  const rows = Array.from({ length: 1001 }, () => ({ content_blocks: null, cover_image_path: null as string | null }))
  rows[1000].cover_image_path = target
  const ranges: Array<[number, number]> = []
  const removals: string[][] = []
  const result = await cleanupEditorialMediaWithReferences([target, other], {
    fetchPage: async (from, to) => {
      ranges.push([from, to])
      return { rows: rows.slice(from, to + 1), error: null }
    },
    remove: async (paths) => { removals.push(paths); return { error: null } },
  })
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]])
  assert.deepEqual(result, { deleted: [other], referenced: [target], error: null })
  assert.deepEqual(removals, [[other]])
})

test('reference lookup failure is fail-closed and never reaches Storage removal', async () => {
  let removeCalls = 0
  const result = await cleanupEditorialMediaWithReferences([target], {
    fetchPage: async (from) => from === 0
      ? { rows: Array.from({ length: 1000 }, () => ({ content_blocks: null, cover_image_path: null })), error: null }
      : { rows: [], error: 'page failed' },
    remove: async () => { removeCalls++; return { error: null } },
  })
  assert.equal(result.error, 'page failed')
  assert.deepEqual(result.deleted, [])
  assert.equal(removeCalls, 0)
})

test('malformed non-null block documents fail closed before Storage removal', async () => {
  let removeCalls = 0
  const result = await cleanupEditorialMediaWithReferences([target], {
    fetchPage: async () => ({
      rows: [{ content_blocks: { version: 1, blocks: [{ type: 'unknown', storagePath: target }] }, cover_image_path: null }],
      error: null,
    }),
    remove: async () => { removeCalls++; return { error: null } },
  })
  assert.match(result.error ?? '', /Invalid content_blocks/)
  assert.equal(removeCalls, 0)
})
