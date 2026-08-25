import assert from 'node:assert/strict'
import test from 'node:test'
import type { ArticleListItem } from '../lib/articles'
// @ts-expect-error Node's built-in TypeScript runner requires the explicit extension.
import { selectHomepageContent, type ManualHomepagePlacement } from '../lib/homepage-selection.ts'

function article(id: string): ArticleListItem {
  return { id, slug: id, title: id, content: '', content_blocks: null, published_at: null,
    cluster_id: null, article_image_url: null, imageUrl: null, category: null, genre: null }
}

const emptyPlacements: ManualHomepagePlacement[] = [
  { placement: 'homepage_hero', articleId: null, updatedAt: null },
  { placement: 'homepage_featured_1', articleId: null, updatedAt: null },
  { placement: 'homepage_featured_2', articleId: null, updatedAt: null },
  { placement: 'homepage_featured_3', articleId: null, updatedAt: null },
]

test('latest Hero와 자동 Featured를 선택하고 effective 항목을 제외해 Latest 19개를 backfill한다', () => {
  const latest = Array.from({ length: 23 }, (_, index) => article(String(index + 1)))
  const candidates = ['1', '2', '3', '4'].map((id) => ({ article: article(id), featuredAt: id }))
  const original = latest.map((item) => item.id)
  const result = selectHomepageContent({
    latestArticles: latest, manualPlacements: emptyPlacements,
    placementArticles: new Map(), featureCandidates: candidates,
    featureArticleIds: new Set(candidates.map((item) => item.article.id)),
  })
  assert.equal(result.hero?.id, '1')
  assert.equal(result.heroSource, 'latest')
  assert.deepEqual(result.featured.map((item) => item.article.id), ['2', '3', '4'])
  assert.deepEqual(result.latest.map((item) => item.id), Array.from({ length: 19 }, (_, index) => String(index + 5)))
  assert.deepEqual(latest.map((item) => item.id), original)
})

test('manual 우선순위로 corrupted duplicate를 제거하고 빈 Featured를 자동 보충한다', () => {
  const a = article('A'); const b = article('B'); const c = article('C'); const d = article('D')
  const result = selectHomepageContent({
    latestArticles: [a, b, c, d],
    manualPlacements: [
      { placement: 'homepage_hero', articleId: 'C', updatedAt: null },
      { placement: 'homepage_featured_1', articleId: 'C', updatedAt: null },
      { placement: 'homepage_featured_2', articleId: 'B', updatedAt: null },
      { placement: 'homepage_featured_3', articleId: null, updatedAt: null },
    ],
    placementArticles: new Map([a, b, c, d].map((item) => [item.id, item])),
    featureCandidates: [c, b, d].map((item) => ({ article: item, featuredAt: item.id })),
    featureArticleIds: new Set(['B', 'C', 'D']),
  })
  assert.equal(result.hero?.id, 'C')
  assert.deepEqual(result.featured.map((item) => [item.placement, item.article.id, item.source]), [
    ['homepage_featured_1', 'D', 'automatic'],
    ['homepage_featured_2', 'B', 'manual'],
  ])
})

test('non-Feature 또는 missing manual placement는 공개하지 않는다', () => {
  const latest = [article('A'), article('B')]
  const result = selectHomepageContent({
    latestArticles: latest,
    manualPlacements: [{ placement: 'homepage_hero', articleId: 'invalid', updatedAt: null }, ...emptyPlacements.slice(1)],
    placementArticles: new Map([['invalid', article('invalid')]]),
    featureCandidates: [], featureArticleIds: new Set(),
  })
  assert.equal(result.hero?.id, 'A')
  assert.equal(result.featured.length, 0)
})
