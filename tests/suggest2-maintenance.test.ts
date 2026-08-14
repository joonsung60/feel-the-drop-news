import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { isSuggest2Enabled, SUGGEST2_DISABLED_BODY } from '../lib/suggest/suggest2-maintenance'

const root = process.cwd()

test('Suggest 2 is enabled only by the exact server value true', () => {
  assert.equal(isSuggest2Enabled(undefined), false)
  assert.equal(isSuggest2Enabled(''), false)
  assert.equal(isSuggest2Enabled('false'), false)
  assert.equal(isSuggest2Enabled('0'), false)
  assert.equal(isSuggest2Enabled('TRUE'), false)
  assert.equal(isSuggest2Enabled('anything'), false)
  assert.equal(isSuggest2Enabled('true'), true)
})

test('disabled response contract is a Korean suggest2_rework maintenance response', () => {
  assert.deepEqual(SUGGEST2_DISABLED_BODY, {
    status: 'disabled',
    code: 'suggest2_rework',
    message: 'Suggest 2는 재설계 중이라 임시 비활성화되어 있습니다. Suggest 1을 이용해 주세요.',
  })
})

test('disabled POST returns 503 without starting any network or background path', async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'test-only-placeholder'
  process.env.SUGGEST2_ENABLED = 'false'
  const originalFetch = globalThis.fetch
  let fetchCalls = 0
  globalThis.fetch = (async () => {
    fetchCalls++
    throw new Error('disabled route must not call fetch')
  }) as typeof fetch
  try {
    const { POST } = await import('../app/api/suggest-clusters/extended/route')
    const response = await POST()
    assert.equal(response.status, 503)
    assert.deepEqual(await response.json(), SUGGEST2_DISABLED_BODY)
    assert.equal(fetchCalls, 0)
  } finally {
    globalThis.fetch = originalFetch
    delete process.env.SUGGEST2_ENABLED
  }
})

test('route checks maintenance before creating background work or touching pipeline dependencies', () => {
  const source = fs.readFileSync(path.join(root, 'app/api/suggest-clusters/extended/route.ts'), 'utf8')
  const guard = source.indexOf('if (!isSuggest2Enabled())')
  assert.ok(guard >= 0)
  assert.ok(guard < source.indexOf('const runBackground'))
  assert.ok(guard < source.indexOf('fetchAllEligibleArticles()', guard))
  assert.match(source.slice(guard, source.indexOf('const runBackground')), /status: 503/)
  assert.match(source.slice(guard, source.indexOf('const runBackground')), /SUGGEST2_DISABLED_BODY/)
})

test('admin and Telegram clients explain maintenance without hiding existing suggestions', () => {
  const admin = fs.readFileSync(path.join(root, 'app/admin/page.tsx'), 'utf8')
  const bot = fs.readFileSync(path.join(root, 'bot/index.ts'), 'utf8')
  for (const source of [admin, bot]) {
    assert.match(source, /res\.status === 503 && data\.code === ['"]suggest2_rework['"]/) 
    assert.match(source, /Suggest 2는 재설계 중이라 임시 비활성화되어 있습니다\. Suggest 1을 이용해 주세요\./)
  }
  assert.match(admin, /fetch\('\/api\/suggest-clusters\?status=pending'\)/)
  assert.match(bot, /LOCAL_API}\/api\/suggest-clusters\?status=pending/)
  assert.match(rootRoute(), /from\('suggested_clusters'\)/)
})

test('Suggest 1 route and existing article-generation route remain present', () => {
  assert.match(rootRoute(), /export async function POST/)
  const generate = fs.readFileSync(path.join(root, 'app/api/generate/route.ts'), 'utf8')
  assert.match(generate, /generate_from_cluster/)
  assert.doesNotMatch(rootRoute(), /SUGGEST2_ENABLED/)
})

function rootRoute() {
  return fs.readFileSync(path.join(root, 'app/api/suggest-clusters/route.ts'), 'utf8')
}
