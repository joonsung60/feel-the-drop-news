import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveArticleCoverImage, resolveArticleListCoverImage, shouldShowCoverInArticle } from '@/lib/article-cover'

const article = 'https://example.com/article.jpg'
const cluster = 'https://example.com/cluster.jpg'
const inline = 'https://example.com/inline.jpg'

test('legacy NULL and auto keep article, cluster, inline priority', () => {
  assert.equal(resolveArticleCoverImage({ mode: null, articleImageUrl: article, clusterImageUrl: cluster, inlineImageUrl: inline }), article)
  assert.equal(resolveArticleCoverImage({ mode: 'auto', clusterImageUrl: cluster, inlineImageUrl: inline }), cluster)
  assert.equal(resolveArticleCoverImage({ mode: 'auto', inlineImageUrl: inline }), inline)
})

test('none suppresses leading fallback and custom never falls back', () => {
  assert.equal(resolveArticleCoverImage({ mode: 'none', articleImageUrl: article, clusterImageUrl: cluster }), null)
  assert.equal(resolveArticleCoverImage({ mode: 'custom', articleImageUrl: article, clusterImageUrl: cluster }), article)
  assert.equal(resolveArticleCoverImage({ mode: 'custom', articleImageUrl: 'invalid', clusterImageUrl: cluster }), null)
})

test('list cover uses projected content inline image after article and cluster fallbacks', () => {
  const content = `본문\n\n![목록 이미지](${inline})`
  assert.equal(resolveArticleListCoverImage({ mode: 'auto', content }), inline)
  assert.equal(resolveArticleListCoverImage({ mode: 'auto', clusterImageUrl: cluster, content }), cluster)
  assert.equal(resolveArticleListCoverImage({ mode: 'none', content }), null)
  assert.equal(resolveArticleListCoverImage({ mode: 'custom', articleImageUrl: article, content }), article)
})

test('article body visibility preserves legacy null and supports thumbnail-only cover', () => {
  assert.equal(shouldShowCoverInArticle(null), true)
  assert.equal(shouldShowCoverInArticle(true), true)
  assert.equal(shouldShowCoverInArticle(false), false)
})
