import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const mutationRoute = readFileSync(
  path.resolve(process.cwd(), 'app/api/admin/homepage/hero/route.ts'),
  'utf8'
)
const deployRoute = readFileSync(
  path.resolve(process.cwd(), 'app/api/admin/homepage/hero/deploy/route.ts'),
  'utf8'
)
const unpublishRoute = readFileSync(
  path.resolve(process.cwd(), 'app/api/articles/[id]/unpublish/route.ts'),
  'utf8'
)

test('Hero GET/PUT/DELETE와 retry POST는 모두 admin authorization을 적용한다', () => {
  assert.match(mutationRoute, /export async function GET/)
  assert.match(mutationRoute, /export async function PUT/)
  assert.match(mutationRoute, /export async function DELETE/)
  assert.equal((mutationRoute.match(/authorizeAdminRequest\(request\)/g) ?? []).length, 3)
  assert.match(deployRoute, /export async function POST/)
  assert.match(deployRoute, /authorizeAdminRequest\(request\)/)
})

test('Hero retry는 공개 deploy route에 의존하지 않고 placement를 변경하지 않는다', () => {
  assert.match(deployRoute, /triggerDeployHook\(\)/)
  assert.doesNotMatch(deployRoute, /api\/deploy|setAdminHomepageHero|\.rpc\(/)
})

test('기존 unpublish route는 deploy hook을 한 번만 호출한다', () => {
  assert.match(unpublishRoute, /completeArticleUnpublish/)
  assert.match(unpublishRoute, /triggerDeploy: triggerDeployHook/)
  assert.match(unpublishRoute, /article: result\.article, deploy: result\.deploy/)
  assert.doesNotMatch(unpublishRoute, /homepage_placements|set_homepage_hero/)
})

test('Admin은 요청 전에 pinned/Feature 여부를 기억하고 결과에 맞는 상태 reload를 사용한다', () => {
  const admin = readFileSync(path.resolve(process.cwd(), 'app/admin/page.tsx'), 'utf8')
  const handler = admin.slice(
    admin.indexOf('const handleUnpublish = async'),
    admin.indexOf('const cancelEdit')
  )
  assert.match(handler, /const wasPinnedHero = homepageHero\?\.articleId === article\.id/)
  assert.match(handler, /const isFeature = homepageEditorial\?\.features\.some/)
  assert.ok(handler.indexOf('const wasPinnedHero') < handler.indexOf("fetch(`/api/articles/"))
  assert.ok(handler.indexOf('const isFeature') < handler.indexOf("fetch(`/api/articles/"))
  assert.match(handler, /resolveHomepageUnpublishOutcome/)
  assert.match(handler, /homepageOutcome\.reloadHero && homepageOutcome\.reloadEditorial/)
  assert.match(handler, /homepageOutcome\.reloadEditorial\) await loadHomepageEditorial\(\)/)
})
