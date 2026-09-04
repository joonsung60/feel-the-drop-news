import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const manifestPath = process.argv[2]
const outputDir = process.argv[3] || 'out'

if (!manifestPath) {
  throw new Error('Usage: node scripts/validate-discoverability.mjs <manifest.json> [out-dir]')
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const sitemapXml = readFileSync('public/sitemap.xml', 'utf8')
const newsSitemapXml = readFileSync('public/news-sitemap.xml', 'utf8')
const redirectsText = readFileSync('public/_redirects', 'utf8')
const errors = []

validateUrlsetXml(sitemapXml, false, errors)
validateUrlsetXml(newsSitemapXml, true, errors)

const sitemapUrls = new Set(extractLocs(sitemapXml))
const newsSitemapUrls = new Set(extractLocs(newsSitemapXml))
const expectedArticleUrls = new Set(manifest.articles.map((article) => article.canonicalUrl))
const expectedRecentUrls = new Set(
  manifest.articles.filter((article) => article.recent).map((article) => article.canonicalUrl)
)
const sitemapArticleUrls = new Set(
  [...sitemapUrls].filter((url) => url.startsWith(`${manifest.siteUrl}/articles/`))
)

compareSets('article sitemap URLs', sitemapArticleUrls, expectedArticleUrls, errors)
compareSets('news sitemap URLs', newsSitemapUrls, expectedRecentUrls, errors)

for (const url of sitemapArticleUrls) {
  const parsed = new URL(url)
  if (parsed.origin !== new URL(manifest.siteUrl).origin || !/^\/articles\/[^/?#]+\/$/.test(parsed.pathname)) {
    errors.push(`Noncanonical article URL in sitemap: ${url}`)
  }
}

const redirectSources = new Set(
  redirectsText.split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean)
)
const sitemapRedirects = [...sitemapUrls]
  .map((url) => new URL(url).pathname)
  .filter((path) => redirectSources.has(path))

const htmlFiles = findFiles(outputDir, (name) => name.endsWith('.html'))
const internalHrefs = new Set()
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8')
  for (const href of extractAttributeValues(html, 'a', 'href')) {
    const path = toInternalPath(href, manifest.siteUrl)
    if (path) internalHrefs.add(path)
  }
}

const noncanonicalInternalUrls = [...internalHrefs].filter(isNoncanonicalHtmlPath)
const redirectingInternalUrls = [...internalHrefs].filter((path) => redirectSources.has(path))
const orphanArticles = manifest.articles.filter(
  (article) => !internalHrefs.has(article.canonicalPath)
)

if (noncanonicalInternalUrls.length > 0) {
  errors.push(`Noncanonical internal HTML URLs: ${noncanonicalInternalUrls.join(', ')}`)
}
if (redirectingInternalUrls.length > 0) {
  errors.push(`Internal URLs matching redirect sources: ${redirectingInternalUrls.join(', ')}`)
}
if (sitemapRedirects.length > 0) {
  errors.push(`Sitemap URLs matching redirect sources: ${sitemapRedirects.join(', ')}`)
}
if (orphanArticles.length > 0) {
  errors.push(`Published articles without crawlable internal links: ${orphanArticles.map((article) => article.canonicalPath).join(', ')}`)
}

for (const article of manifest.articles) {
  const htmlPath = join(outputDir, article.canonicalPath.slice(1), 'index.html')
  if (!existsSync(htmlPath)) {
    errors.push(`Missing generated article HTML: ${article.canonicalPath}`)
    continue
  }

  const html = readFileSync(htmlPath, 'utf8')
  const canonical = extractMetadataValue(html, 'link', 'rel', 'canonical', 'href')
  const openGraphUrl = extractMetadataValue(html, 'meta', 'property', 'og:url', 'content')
  const newsArticle = extractJsonLd(html).find((value) => value?.['@type'] === 'NewsArticle')
  const structuredUrl = newsArticle?.mainEntityOfPage?.['@id']

  if (canonical !== article.canonicalUrl) {
    errors.push(`Canonical metadata mismatch for ${article.canonicalPath}: ${canonical ?? 'missing'}`)
  }
  if (openGraphUrl !== article.canonicalUrl) {
    errors.push(`OpenGraph URL mismatch for ${article.canonicalPath}: ${openGraphUrl ?? 'missing'}`)
  }
  if (structuredUrl !== article.canonicalUrl) {
    errors.push(`NewsArticle URL mismatch for ${article.canonicalPath}: ${structuredUrl ?? 'missing'}`)
  }
}

const summary = {
  publishedArticles: manifest.articles.length,
  articleUrlsInSitemap: sitemapArticleUrls.size,
  recentArticlesInNewsSitemap: newsSitemapUrls.size,
  noncanonicalInternalUrls: noncanonicalInternalUrls.length,
  sitemapUrlsThatWouldRedirect: sitemapRedirects.length,
  redirectingInternalUrls: redirectingInternalUrls.length,
  orphanPublishedArticles: orphanArticles.length,
}

console.log('Discoverability verification summary')
console.log(JSON.stringify(summary, null, 2))

if (errors.length > 0) {
  throw new Error(`Discoverability verification failed:\n- ${errors.join('\n- ')}`)
}

function validateUrlsetXml(xml, requireNews, validationErrors) {
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')) {
    validationErrors.push('XML declaration is missing or invalid')
  }
  if (!/<urlset\b[^>]*>[\s\S]*<\/urlset>\s*$/.test(xml)) {
    validationErrors.push('Sitemap urlset root is invalid')
  }
  if (/&(?!amp;|lt;|gt;|quot;|apos;)/.test(xml)) {
    validationErrors.push('Sitemap contains an unescaped ampersand')
  }

  const urls = xml.match(/<url>/g)?.length ?? 0
  const closingUrls = xml.match(/<\/url>/g)?.length ?? 0
  const locs = xml.match(/<loc>/g)?.length ?? 0
  if (urls !== closingUrls || urls !== locs) {
    validationErrors.push(`Sitemap URL element counts differ (${urls}/${closingUrls}/${locs})`)
  }

  if (requireNews) {
    if (!xml.includes('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"')) {
      validationErrors.push('News sitemap namespace is missing')
    }
    for (const requiredTag of ['news:news', 'news:publication', 'news:name', 'news:language', 'news:publication_date', 'news:title']) {
      const opening = xml.match(new RegExp(`<${requiredTag}>`, 'g'))?.length ?? 0
      const closing = xml.match(new RegExp(`</${requiredTag}>`, 'g'))?.length ?? 0
      if (opening !== urls || closing !== urls) {
        validationErrors.push(`News sitemap ${requiredTag} count differs from URL count`)
      }
    }
  }
}

function compareSets(label, actual, expected, validationErrors) {
  const missing = [...expected].filter((value) => !actual.has(value))
  const extra = [...actual].filter((value) => !expected.has(value))
  if (missing.length > 0) validationErrors.push(`Missing ${label}: ${missing.join(', ')}`)
  if (extra.length > 0) validationErrors.push(`Unexpected ${label}: ${extra.join(', ')}`)
}

function extractLocs(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => decodeXml(match[1]))
}

function decodeXml(value) {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}

function findFiles(directory, predicate) {
  const files = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...findFiles(path, predicate))
    else if (predicate(entry.name)) files.push(path)
  }
  return files
}

function extractAttributeValues(html, tagName, attribute) {
  const values = []
  for (const match of html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))) {
    const attributes = parseAttributes(match[0])
    if (attributes[attribute]) values.push(attributes[attribute])
  }
  return values
}

function extractMetadataValue(html, tagName, key, expected, valueKey) {
  for (const match of html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))) {
    const attributes = parseAttributes(match[0])
    if (attributes[key] === expected) return attributes[valueKey] ?? null
  }
  return null
}

function parseAttributes(tag) {
  const attributes = {}
  for (const match of tag.matchAll(/([:\w-]+)="([^"]*)"/g)) {
    attributes[match[1].toLowerCase()] = match[2]
  }
  return attributes
}

function extractJsonLd(html) {
  const values = []
  for (const match of html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      values.push(JSON.parse(match[1]))
    } catch {
      errors.push('Generated page contains invalid JSON-LD')
    }
  }
  return values
}

function toInternalPath(href, siteUrl) {
  try {
    const site = new URL(siteUrl)
    const url = new URL(href, `${siteUrl}/`)
    if (url.origin !== site.origin) return null
    return url.pathname
  } catch {
    return null
  }
}

function isNoncanonicalHtmlPath(path) {
  if (path === '/' || path.endsWith('/')) return false
  if (path.startsWith('/_next/') || path.startsWith('/api/') || path.startsWith('/admin')) return false
  return !/\.[a-z0-9]+$/i.test(path)
}
