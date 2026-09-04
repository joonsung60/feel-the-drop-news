import assert from 'node:assert/strict'
import test from 'node:test'
import {
  articleLastModified,
  articlePath,
  isRecentPublishedArticle,
  renderNewsSitemap,
  renderSitemap,
} from '../scripts/discovery-artifacts.mjs'

const now = new Date('2026-09-04T12:00:00.000Z')

test('canonical article paths always use the final trailing-slash form', () => {
  assert.equal(articlePath({ id: 'id-1', slug: 'trico-2026' }), '/articles/trico-2026/')
  assert.equal(articlePath({ id: 'id-1', slug: null }), '/articles/id-1/')
})

test('sitemap lastmod uses only a valid stored content timestamp', () => {
  assert.equal(articleLastModified({
    updated_at: 'invalid',
    published_at: '2026-09-03T10:30:00+09:00',
    created_at: '2026-09-01T00:00:00Z',
  }), '2026-09-03T01:30:00.000Z')
  assert.equal(articleLastModified({
    updated_at: null,
    published_at: null,
    created_at: 'invalid',
  }), null)

  const xml = renderSitemap([
    { loc: 'https://feel-the-drop.com/', lastmod: null },
    { loc: 'https://feel-the-drop.com/articles/a/', lastmod: '2026-09-03T00:00:00.000Z' },
  ])
  assert.match(xml, /<loc>https:\/\/feel-the-drop\.com\/<\/loc>\n  <\/url>/)
  assert.match(xml, /<lastmod>2026-09-03T00:00:00\.000Z<\/lastmod>/)
})

test('news sitemap contains only actually published articles from the last two days', () => {
  const articles = [
    { id: 'recent', slug: 'recent', title: '최근 & 기사', published_at: '2026-09-04T00:00:00Z' },
    { id: 'boundary', slug: 'boundary', title: '경계 기사', published_at: '2026-09-02T12:00:00Z' },
    { id: 'old', slug: 'old', title: '오래된 기사', published_at: '2026-09-02T11:59:59Z' },
    { id: 'future', slug: 'future', title: '미래 기사', published_at: '2026-09-04T12:00:01Z' },
    { id: 'unknown', slug: 'unknown', title: '날짜 없음', published_at: null },
  ]

  assert.equal(isRecentPublishedArticle(articles[0], now), true)
  assert.equal(isRecentPublishedArticle(articles[1], now), true)
  assert.equal(isRecentPublishedArticle(articles[2], now), false)
  assert.equal(isRecentPublishedArticle(articles[3], now), false)

  const xml = renderNewsSitemap({
    siteUrl: 'https://feel-the-drop.com',
    articles,
    now,
  })
  assert.match(xml, /<news:language>ko<\/news:language>/)
  assert.match(xml, /<news:title>최근 &amp; 기사<\/news:title>/)
  assert.match(xml, /\/articles\/boundary\//)
  assert.doesNotMatch(xml, /\/articles\/(old|future|unknown)\//)
  assert.equal((xml.match(/<url>/g) ?? []).length, 2)
})

test('an empty news sitemap remains a valid namespaced urlset', () => {
  const xml = renderNewsSitemap({
    siteUrl: 'https://feel-the-drop.com',
    articles: [],
    now,
  })
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/)
  assert.match(xml, /xmlns:news="http:\/\/www\.google\.com\/schemas\/sitemap-news\/0\.9"/)
  assert.match(xml, /<\/urlset>\n$/)
})
