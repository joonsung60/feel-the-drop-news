import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const page = readFileSync(path.resolve(process.cwd(), 'app/page.tsx'), 'utf8')
const articles = readFileSync(path.resolve(process.cwd(), 'lib/articles.ts'), 'utf8')

test('pinned article 별도 조회는 published 조건과 기존 cover projection을 재사용한다', () => {
  const loader = articles.slice(
    articles.indexOf('export async function loadPublishedArticleById'),
    articles.indexOf('const loadPublishedArchiveIndex')
  )
  assert.match(loader, /\.eq\('published', true\)/)
  assert.match(loader, /loadImagesByCluster\(\[row\]\)/)
  assert.match(loader, /toArticleListItem\(row, imageByCluster\)/)
})

test('홈페이지는 placement 오류를 non-fatal fallback하고 popular 입력을 재정렬하지 않는다', () => {
  assert.match(page, /placement 조회 실패, 최신 기사로 대체/)
  assert.match(page, /loadPublishedArticleById\(placement\.articleId\)/)
  assert.match(page, /loadPopularArticles\(articles, 5\)/)
  assert.match(page, /selectHomepageHero\(articles, pinnedArticle\)/)
})

