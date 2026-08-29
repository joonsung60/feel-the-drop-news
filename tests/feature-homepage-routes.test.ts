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

test('기사 카드는 Feature 자격만 관리하고 placement 버튼을 나열하지 않는다', () => {
  const source = readFileSync(path.resolve('app/admin/page.tsx'), 'utf8')
  const cards = source.slice(source.indexOf('{articles.map((article)'), source.indexOf('function ArticlePreviewModal'))
  assert.match(cards, />Feature 지정<\/button>/)
  assert.match(cards, />Feature 해제<\/button>/)
  assert.doesNotMatch(cards, /Feature \+|로 지정<\/button>|현재 \{placementLabel/)
  assert.match(cards, /className="flex min-w-0 flex-col gap-4"/)
  assert.match(cards, /className="flex w-full min-w-0 flex-wrap gap-2"/)
})

test('Homepage 편집판은 네 drop zone과 drag 및 키보드 대체 조작을 제공한다', () => {
  const source = readFileSync(path.resolve('app/admin/page.tsx'), 'utf8')
  assert.match(source, /data-placement-drop-zone=\{item\.placement\}/)
  assert.match(source, /onDragStart=/)
  assert.match(source, /onDragOver=/)
  assert.match(source, /onDrop=/)
  assert.match(source, /handlePlacementDrop\(item\.placement, articleId\)/)
  assert.match(source, /data-feature-drag-handle=\{feature\.articleId\}/)
  assert.match(source, /data-placement-drag-handle=\{item\.placement\}/)
  assert.match(source, /data-feature-drag-handle=\{feature\.articleId\}[\s\S]*draggable=\{!homepageMutationBusy\}/)
  const featureCard = source.slice(source.indexOf('data-feature-card={feature.articleId}') - 100)
  const featureCardOpeningTag = featureCard.slice(0, featureCard.indexOf('>'))
  assert.doesNotMatch(featureCardOpeningTag, /draggable=/)
  assert.ok(featureCard.indexOf('data-feature-drag-handle={feature.articleId}') < featureCard.indexOf('<select'))
  assert.ok(featureCard.indexOf('data-feature-drag-handle={feature.articleId}') < featureCard.indexOf('Feature 해제'))
  assert.match(source, /disabled=\{homepageMutationBusy\}/)
  assert.match(source, /<option value="">배치 없음<\/option>/)
  for (const placement of ['homepage_hero', 'homepage_featured_1', 'homepage_featured_2', 'homepage_featured_3']) {
    assert.match(source, new RegExp(`<option value="${placement}">`), placement)
  }
})

test('drop과 수동 해제는 기존 placement API를 그대로 사용한다', () => {
  const source = readFileSync(path.resolve('app/admin/page.tsx'), 'utf8')
  const setHandler = source.slice(source.indexOf('const handleSetPlacement = async'), source.indexOf('const handleClearPlacement'))
  const clearHandler = source.slice(source.indexOf('const handleClearPlacement = async'), source.indexOf('const handlePlacementDrop'))
  assert.match(setHandler, /fetch\(`\/api\/admin\/homepage\/placements\/\$\{placement\}`/)
  assert.match(setHandler, /method: 'PUT'/)
  assert.match(setHandler, /confirmAndApplyHomepagePlacement/)
  assert.match(clearHandler, /fetch\(`\/api\/admin\/homepage\/placements\/\$\{placement\}`/)
  assert.match(clearHandler, /method: 'DELETE'/)
})

test('Feature 편집판 summary는 category를 포함한다', () => {
  const source = readFileSync(path.resolve('lib/homepage-editorial-admin.ts'), 'utf8')
  assert.match(source, /published_at, category/)
})
