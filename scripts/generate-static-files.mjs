import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import {
  articleLastModified,
  articlePath,
  articleUrl,
  isRecentPublishedArticle,
  renderNewsSitemap,
  renderSitemap,
  toReliableIso,
} from './discovery-artifacts.mjs'

const taxonomy = JSON.parse(
  readFileSync(new URL('../lib/taxonomy.json', import.meta.url), 'utf8')
)
const CATEGORY_SLUGS = taxonomy.categories.map(({ slug }) => slug)
const GENRE_SLUGS = taxonomy.releaseGenres.map(({ slug }) => slug)

// Keep this fallback synchronized with lib/site.ts.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://feel-the-drop.com').replace(/\/$/, '')
const QUERY_PAGE_SIZE = 1000

function loadEnvLocal() {
  let text = ''
  try {
    text = readFileSync('.env.local', 'utf8')
  } catch {
    return
  }

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue
    const index = trimmed.indexOf('=')
    const key = trimmed.slice(0, index).trim()
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '')
    if (key && process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadEnvLocal()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)
const publishedArticles = []

for (let from = 0; ; from += QUERY_PAGE_SIZE) {
  const { data, error } = await supabase
    .from('articles')
    .select('id, slug, title, published_at, updated_at, created_at')
    .eq('published', true)
    .order('published_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .range(from, from + QUERY_PAGE_SIZE - 1)

  if (error) {
    throw new Error(`Failed to load articles for discovery artifacts: ${error.message}`)
  }

  const batch = data ?? []
  publishedArticles.push(...batch)
  if (batch.length < QUERY_PAGE_SIZE) break
}

mkdirSync('public', { recursive: true })

const generatedAt = new Date()
const articlesWithSlug = publishedArticles.filter((article) => article.slug)
const staticPaths = [
  '/',
  '/archive/',
  '/features/',
  '/press/',
  ...CATEGORY_SLUGS.map((slug) => `/category/${slug}/`),
  ...GENRE_SLUGS.map((slug) => `/genre/${slug}/`),
]
const sitemapEntries = [
  ...staticPaths.map((path) => ({ loc: `${SITE_URL}${path}`, lastmod: null })),
  ...publishedArticles.map((article) => ({
    loc: articleUrl(SITE_URL, article),
    lastmod: articleLastModified(article),
  })),
]

const sitemap = renderSitemap(sitemapEntries)
const newsSitemap = renderNewsSitemap({
  siteUrl: SITE_URL,
  articles: publishedArticles,
  now: generatedAt,
})

const robots = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
Sitemap: ${SITE_URL}/news-sitemap.xml
`

const llms = `# FEEL THE DROP

> Korean-language EDM and electronic music news site. Articles are generated from curated English-language source articles, then reviewed before publication.

Base URL: ${SITE_URL}
Sitemap: ${SITE_URL}/sitemap.xml
News Sitemap: ${SITE_URL}/news-sitemap.xml

## Public Content

- Home: ${SITE_URL}/
- Articles: ${SITE_URL}/archive/
- Features: ${SITE_URL}/features/

## Notes for AI Crawlers

- Crawl public article pages only.
- Do not use or infer access to local admin/API routes.
- Published article pages are static Cloudflare Pages output.
`

const redirects = articlesWithSlug
  .map((article) => `/articles/${article.id}/ ${articlePath(article)} 301`)
  .join('\n') + '\n'

writeFileSync('public/sitemap.xml', sitemap)
writeFileSync('public/news-sitemap.xml', newsSitemap)
writeFileSync('public/robots.txt', robots)
writeFileSync('public/llms.txt', llms)
writeFileSync('public/_redirects', redirects)

const manifestPath = process.env.DISCOVERY_MANIFEST_PATH
if (manifestPath) {
  mkdirSync(dirname(manifestPath), { recursive: true })
  writeFileSync(manifestPath, JSON.stringify({
    generatedAt: generatedAt.toISOString(),
    siteUrl: SITE_URL,
    articles: publishedArticles.map((article) => ({
      id: article.id,
      slug: article.slug,
      title: article.title,
      publishedAt: toReliableIso(article.published_at),
      canonicalPath: articlePath(article),
      canonicalUrl: articleUrl(SITE_URL, article),
      recent: isRecentPublishedArticle(article, generatedAt),
    })),
  }, null, 2))
}

const recentCount = publishedArticles.filter((article) =>
  isRecentPublishedArticle(article, generatedAt)
).length
console.log(
  `Generated sitemap.xml, news-sitemap.xml, robots.txt, llms.txt, _redirects for ${publishedArticles.length} published articles (${recentCount} recent, ${articlesWithSlug.length} with slug)`
)
