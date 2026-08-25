import assert from 'node:assert/strict'
import test from 'node:test'
import type { ArticleListItem } from '../lib/articles'
import { selectHomepageHero } from '../lib/homepage-hero'

function article(id: string): ArticleListItem {
  return {
    id,
    slug: id,
    title: id,
    content: '',
    content_blocks: null,
    published_at: null,
    cluster_id: null,
    article_image_url: null,
    imageUrl: null,
    category: null,
    genre: null,
  }
}

test('pin이 없으면 최신 첫 기사가 Hero이고 나머지가 Latest다', () => {
  const articles = ['A', 'B', 'C'].map(article)
  const result = selectHomepageHero(articles, null)
  assert.equal(result.hero?.id, 'A')
  assert.deepEqual(result.latest.map((item) => item.id), ['B', 'C'])
})

test('최신 목록 안의 pinned 기사를 Hero로 쓰고 중복 없이 backfill한다', () => {
  const articles = Array.from({ length: 20 }, (_, index) => article(String(index + 1)))
  const result = selectHomepageHero(articles, articles[2])
  assert.equal(result.hero?.id, '3')
  assert.equal(result.latest.length, 19)
  assert.deepEqual(result.latest.slice(0, 4).map((item) => item.id), ['1', '2', '4', '5'])
  assert.equal(result.latest.some((item) => item.id === '3'), false)
  assert.equal(result.latest.at(-1)?.id, '20')
})

test('최신 범위 밖 pinned 기사를 Hero로 쓰고 최신 19개를 유지한다', () => {
  const articles = Array.from({ length: 20 }, (_, index) => article(String(index + 1)))
  const originalOrder = articles.map((item) => item.id)
  const result = selectHomepageHero(articles, article('old'))
  assert.equal(result.hero?.id, 'old')
  assert.deepEqual(
    result.latest.map((item) => item.id),
    Array.from({ length: 19 }, (_, index) => String(index + 1))
  )
  assert.deepEqual(articles.map((item) => item.id), originalOrder)
})

test('유효한 Hero가 없으면 빈 결과를 반환한다', () => {
  assert.deepEqual(selectHomepageHero([], null), { hero: null, latest: [] })
})
