import assert from 'node:assert/strict'
import test from 'node:test'
import type { ArticleBlockDocument } from '@/lib/article-blocks'
import { EditorialUploadSession } from '@/lib/editorial-upload-session'

const paths = {
  cover1: 'editorial/2026/08/11111111-1111-4111-8111-111111111111.png',
  cover2: 'editorial/2026/08/22222222-2222-4222-8222-222222222222.png',
  inline1: 'editorial/2026/08/33333333-3333-4333-8333-333333333333.png',
  inline2: 'editorial/2026/08/44444444-4444-4444-8444-444444444444.png',
  existing: 'editorial/2026/08/55555555-5555-4555-8555-555555555555.png',
}

const paragraph: ArticleBlockDocument = {
  version: 1,
  blocks: [{ type: 'paragraph', content: [{ type: 'text', text: '본문' }] }],
}
const withImage = (path: string): ArticleBlockDocument => ({
  version: 1,
  blocks: [{ type: 'image', src: `https://example.com/${path.slice(-4)}`, alt: '', storagePath: path }],
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolver) => { resolve = resolver })
  return { promise, resolve }
}

test('cover replacement and direct URL edit clean only session uploads', async () => {
  const session = new EditorialUploadSession()
  const deleted: string[] = []
  const remove = async (path: string) => { deleted.push(path); return true }
  session.register(paths.cover1)
  await session.reconcile(paragraph, paths.cover1, remove)
  assert.deepEqual(deleted, [])
  session.register(paths.cover2)
  await session.reconcile(paragraph, paths.cover2, remove)
  assert.deepEqual(deleted, [paths.cover1])
  await session.reconcile(paragraph, null, remove)
  assert.deepEqual(deleted, [paths.cover1, paths.cover2])
  await session.reconcile(paragraph, paths.existing, remove)
  assert.equal(new Set<string>(deleted).has(paths.existing), false)
})

test('inline replacement, src edit, type change, deletion, and Markdown import clean orphan uploads', async () => {
  const session = new EditorialUploadSession()
  const deleted: string[] = []
  const remove = async (path: string) => { deleted.push(path); return true }
  session.register(paths.inline1)
  await session.reconcile(withImage(paths.inline1), null, remove)
  session.register(paths.inline2)
  await session.reconcile(withImage(paths.inline2), null, remove)
  assert.deepEqual(deleted, [paths.inline1])
  await session.reconcile({ version: 1, blocks: [{ type: 'image', src: 'https://example.com/direct.png', alt: '' }] }, null, remove)
  assert.deepEqual(deleted, [paths.inline1, paths.inline2])

  for (const path of [paths.inline1, paths.inline2]) session.register(path)
  await session.reconcile(withImage(paths.inline1), null, remove)
  assert.equal(deleted.at(-1), paths.inline2)
  await session.reconcile(paragraph, null, remove)
  assert.equal(deleted.at(-1), paths.inline1)

  session.register(paths.inline1)
  await session.reconcile(withImage(paths.inline1), null, remove)
  await session.reconcile({ version: 1, blocks: [] }, null, remove)
  assert.equal(deleted.at(-1), paths.inline1)

  session.register(paths.inline2)
  await session.reconcile(withImage(paths.inline2), null, remove)
  await session.reconcile(paragraph, null, remove)
  assert.equal(deleted.at(-1), paths.inline2)
})

test('successful save preserves referenced uploads, deletes orphans, and clears the registry', async () => {
  const session = new EditorialUploadSession()
  const deleted: string[] = []
  session.register(paths.cover1)
  session.register(paths.inline1)
  session.register(paths.inline2)
  const document = withImage(paths.inline1)
  await session.finishSave(document, paths.cover1, async (path) => { deleted.push(path); return true })
  assert.deepEqual(deleted, [paths.inline2])
  assert.deepEqual(session.list(), [])
})

test('closing an unsaved editor best-effort deletes every session upload', async () => {
  const session = new EditorialUploadSession()
  session.register(paths.cover1)
  session.register(paths.inline1)
  const deleted: string[] = []
  await session.abandon(async (path) => { deleted.push(path); return true })
  assert.deepEqual(new Set(deleted), new Set([paths.cover1, paths.inline1]))
  assert.deepEqual(session.list(), [])
})

test('queued reconcile cleanup never adopts uploads registered after its candidate snapshot', async () => {
  const session = new EditorialUploadSession()
  const firstDeleteStarted = deferred<void>()
  const releaseFirstDelete = deferred<boolean>()
  const deleted: string[] = []
  const remove = async (path: string) => {
    deleted.push(path)
    if (path === paths.inline1) {
      firstDeleteStarted.resolve()
      return releaseFirstDelete.promise
    }
    return true
  }

  session.register(paths.inline1)
  const firstCleanup = session.reconcile(paragraph, null, remove)
  await firstDeleteStarted.promise

  session.register(paths.inline2)
  const secondCleanup = session.reconcile(withImage(paths.inline2), null, remove)
  session.register(paths.cover1)
  const finalCleanup = session.reconcile(withImage(paths.cover1), null, remove)

  releaseFirstDelete.resolve(true)
  await Promise.all([firstCleanup, secondCleanup, finalCleanup])

  assert.deepEqual(deleted, [paths.inline1, paths.inline2])
  assert.equal(deleted.includes(paths.cover1), false)
  assert.deepEqual(session.list(), [paths.cover1])
})

test('finishSave interleaving preserves the latest saved upload', async () => {
  const session = new EditorialUploadSession()
  const firstDeleteStarted = deferred<void>()
  const releaseFirstDelete = deferred<boolean>()
  const deleted: string[] = []
  const remove = async (path: string) => {
    deleted.push(path)
    if (path === paths.inline1) {
      firstDeleteStarted.resolve()
      return releaseFirstDelete.promise
    }
    return true
  }

  session.register(paths.inline1)
  const firstCleanup = session.reconcile(paragraph, null, remove)
  await firstDeleteStarted.promise

  session.register(paths.inline2)
  const secondCleanup = session.reconcile(withImage(paths.inline2), null, remove)
  session.register(paths.cover1)
  const saveCleanup = session.finishSave(withImage(paths.cover1), null, remove)

  releaseFirstDelete.resolve(true)
  await Promise.all([firstCleanup, secondCleanup, saveCleanup])

  assert.deepEqual(deleted, [paths.inline1, paths.inline2])
  assert.equal(deleted.includes(paths.cover1), false)
  assert.deepEqual(session.list(), [])
})

test('abandon cleanup does not adopt uploads registered after close snapshot', async () => {
  const session = new EditorialUploadSession()
  const firstDeleteStarted = deferred<void>()
  const releaseFirstDelete = deferred<boolean>()
  const deleted: string[] = []
  session.register(paths.inline1)
  const cleanup = session.abandon(async (path) => {
    deleted.push(path)
    firstDeleteStarted.resolve()
    return releaseFirstDelete.promise
  })
  await firstDeleteStarted.promise

  session.register(paths.inline2)
  releaseFirstDelete.resolve(true)
  await cleanup

  assert.deepEqual(deleted, [paths.inline1])
  assert.deepEqual(session.list(), [paths.inline2])
})
