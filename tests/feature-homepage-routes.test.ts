import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const files = [
  'app/api/admin/articles/[id]/feature/route.ts',
  'app/api/admin/homepage/placements/route.ts',
  'app/api/admin/homepage/placements/[placement]/route.ts',
  'app/api/admin/homepage/deploy/route.ts',
]

test('모든 Feature/Homepage Admin route가 기존 authorization 경계를 사용한다', () => {
  for (const file of files) {
    const source = readFileSync(path.resolve(file), 'utf8')
    assert.match(source, /authorizeAdminRequest\(request\)/, file)
  }
})

test('Feature와 placement mutation은 공통 changed/deploy 경계를 사용한다', () => {
  for (const file of [files[0], files[2]]) {
    const source = readFileSync(path.resolve(file), 'utf8')
    assert.match(source, /applyEditorialMutation/, file)
    assert.match(source, /triggerDeployHook/, file)
  }
})

test('인증된 retry는 공개 deploy route나 DB mutation을 사용하지 않는다', () => {
  const source = readFileSync(path.resolve(files[3]), 'utf8')
  assert.match(source, /triggerDeployHook\(\)/)
  assert.doesNotMatch(source, /api\/deploy|\.rpc\(|setAdmin/)
})

test('Feature archive는 DB range pagination, published inner join과 정적 params를 사용한다', () => {
  const loader = readFileSync(path.resolve('lib/article-features.ts'), 'utf8')
  const page = readFileSync(path.resolve('app/features/page/[page]/page.tsx'), 'utf8')
  assert.match(loader, /articles!inner\(id\)/)
  assert.match(loader, /\.eq\('articles\.published', true\)/)
  assert.match(loader, /\.range\(from, from \+ pageSize - 1\)/)
  assert.match(page, /dynamicParams = false/)
  assert.match(page, /generateStaticParams/)
  assert.match(page, /params: Promise/)
})

test('Admin Homepage mutation은 이전 오류를 지우고 공통 busy 조건을 공유한다', () => {
  const source = readFileSync(path.resolve('app/admin/page.tsx'), 'utf8')
  assert.match(source, /const homepageMutationBusy = processing !== null \|\| heroProcessingId !== null \|\|\s*editorialProcessingId !== null \|\| isHeroDeploying/)
  assert.match(source, /const articleHomepageMutationBusy = homepageMutationBusy \|\| editingId !== null \|\| replacingId !== null/)

  for (const handler of ['handleSetPlacement', 'handleClearPlacement', 'handleRemoveFeature']) {
    const start = source.indexOf(`const ${handler} = async`)
    const end = source.indexOf('\n  const ', start + 1)
    assert.notEqual(start, -1, handler)
    assert.match(source.slice(start, end), /setHeroError\(''\)/, handler)
  }

  assert.match(source, /disabled=\{homepageMutationBusy\}/)
  assert.match(source, /disabled=\{articleHomepageMutationBusy\}/)
})
