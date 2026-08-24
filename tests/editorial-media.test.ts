import assert from 'node:assert/strict'
import test from 'node:test'
import { collectManagedEditorialPaths, createEditorialStoragePath, detectEditorialImageMime, isManagedEditorialPath } from '@/lib/editorial-media'

test('detects JPEG, PNG, and WebP by signature instead of extension', () => {
  assert.equal(detectEditorialImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0x00])), 'image/jpeg')
  assert.equal(detectEditorialImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png')
  assert.equal(detectEditorialImageMime(Uint8Array.from([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])), 'image/webp')
  assert.equal(detectEditorialImageMime(Uint8Array.from([1, 2, 3])), null)
})

test('collects only managed cover and inline media paths', () => {
  const cover = 'editorial/2026/08/11111111-1111-4111-8111-111111111111.png'
  const inline = 'editorial/2026/08/22222222-2222-4222-8222-222222222222.webp'
  const paths = collectManagedEditorialPaths({ version: 1, blocks: [
    { type: 'image', src: 'https://example.com/a.webp', alt: '', storagePath: inline },
    { type: 'image', src: 'https://example.com/external.jpg', alt: '' },
  ] }, cover)
  assert.deepEqual([...paths], [cover, inline])
})

test('managed paths are UUID-based and reject traversal or other prefixes', () => {
  const path = createEditorialStoragePath('image/png', new Date('2026-08-24T00:00:00Z'), '11111111-1111-4111-8111-111111111111')
  assert.equal(path, 'editorial/2026/08/11111111-1111-4111-8111-111111111111.png')
  assert.equal(isManagedEditorialPath(path), true)
  assert.equal(isManagedEditorialPath('editorial/../../secret.png'), false)
  assert.equal(isManagedEditorialPath('2026/articles/file.png'), false)
})
