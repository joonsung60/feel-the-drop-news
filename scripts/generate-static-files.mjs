import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const taxonomy = JSON.parse(
  readFileSync(new URL('../lib/taxonomy.json', import.meta.url), 'utf8')
)
const CATEGORY_SLUGS = taxonomy.categories.map(({ slug }) => slug)
const GENRE_SLUGS = taxonomy.releaseGenres.map(({ slug }) => slug)

// Keep this fallback synchronized with lib/site.ts.
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://feel-the-drop.com').replace(/\/$/, '')

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

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatDate(value) {
  if (!value) return new Date().toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

loadEnvLocal()

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required')
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

const { data: articles, error } = await supabase
  .from('articles')
  .select('id, slug, title, published_at, updated_at, created_at')
  .eq('published', true)
  .order('published_at', { ascending: false })
  .limit(5000)

if (error) {
  throw new Error(`Failed to load articles for sitemap: ${error.message}`)
}

mkdirSync('public', { recursive: true })

const publishedArticles = articles ?? []
const articlesWithSlug = publishedArticles.filter((article) => article.slug)

const urls = [
  {
    loc: `${SITE_URL}/`,
    lastmod: new Date().toISOString(),
    changefreq: 'hourly',
    priority: '1.0',
  },
  {
    loc: `${SITE_URL}/archive/`,
    lastmod: new Date().toISOString(),
    changefreq: 'daily',
    priority: '0.7',
  },
  {
    loc: `${SITE_URL}/features/`,
    lastmod: new Date().toISOString(),
    changefreq: 'daily',
    priority: '0.8',
  },
  {
    loc: `${SITE_URL}/press/`,
    lastmod: new Date().toISOString(),
    changefreq: 'monthly',
    priority: '0.5',
  },
  ...CATEGORY_SLUGS.map((slug) => ({
    loc: `${SITE_URL}/category/${slug}/`,
    lastmod: new Date().toISOString(),
    changefreq: 'daily',
    priority: '0.7',
  })),
  ...GENRE_SLUGS.map((slug) => ({
    loc: `${SITE_URL}/genre/${slug}/`,
    lastmod: new Date().toISOString(),
    changefreq: 'daily',
    priority: '0.6',
  })),
  ...publishedArticles.map((article) => ({
    loc: `${SITE_URL}/articles/${article.slug ?? article.id}/`,
    lastmod: formatDate(article.updated_at || article.published_at || article.created_at),
    changefreq: 'daily',
    priority: '0.8',
  })),
]

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url>
    <loc>${escapeXml(url.loc)}</loc>
    <lastmod>${escapeXml(url.lastmod)}</lastmod>
    <changefreq>${url.changefreq}</changefreq>
    <priority>${url.priority}</priority>
  </url>`).join('\n')}
</urlset>
`

const robots = `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
`

const llms = `# FEEL THE DROP

> Korean-language EDM and electronic music news site. Articles are generated from curated English-language source articles, then reviewed before publication.

Base URL: ${SITE_URL}
Sitemap: ${SITE_URL}/sitemap.xml

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
  .map((article) => `/articles/${article.id}/ /articles/${article.slug}/ 301`)
  .join('\n') + '\n'

writeFileSync('public/sitemap.xml', sitemap)
writeFileSync('public/robots.txt', robots)
writeFileSync('public/llms.txt', llms)
writeFileSync('public/_redirects', redirects)

console.log(`Generated sitemap.xml, robots.txt, llms.txt, _redirects for ${(articles ?? []).length} published articles (${articlesWithSlug.length} with slug)`)
