export const NEWS_SITEMAP_WINDOW_MS = 2 * 24 * 60 * 60 * 1000

export function articlePath(article) {
  const key = article.slug ?? article.id
  if (!key) throw new Error('Article URL requires a slug or id')
  return `/articles/${key}/`
}

export function articleUrl(siteUrl, article) {
  return `${siteUrl}${articlePath(article)}`
}

export function toReliableIso(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function articleLastModified(article) {
  return (
    toReliableIso(article.updated_at) ||
    toReliableIso(article.published_at) ||
    toReliableIso(article.created_at)
  )
}

export function isRecentPublishedArticle(article, now = new Date()) {
  const publishedAt = toReliableIso(article.published_at)
  if (!publishedAt) return false

  const age = now.getTime() - Date.parse(publishedAt)
  return age >= 0 && age <= NEWS_SITEMAP_WINDOW_MS
}

export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export function renderSitemap(entries) {
  const body = entries.map(({ loc, lastmod }) => {
    const lastmodXml = lastmod
      ? `\n    <lastmod>${escapeXml(lastmod)}</lastmod>`
      : ''
    return `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmodXml}\n  </url>`
  }).join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

export function renderNewsSitemap({ siteUrl, articles, now = new Date() }) {
  const body = articles
    .filter((article) => isRecentPublishedArticle(article, now))
    .map((article) => `  <url>
    <loc>${escapeXml(articleUrl(siteUrl, article))}</loc>
    <news:news>
      <news:publication>
        <news:name>FEEL THE DROP</news:name>
        <news:language>ko</news:language>
      </news:publication>
      <news:publication_date>${escapeXml(toReliableIso(article.published_at))}</news:publication_date>
      <news:title>${escapeXml(article.title)}</news:title>
    </news:news>
  </url>`)
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${body}
</urlset>
`
}
