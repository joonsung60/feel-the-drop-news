import { loadPublishedArticles } from '@/lib/articles'
import { SITE_URL } from '@/lib/site'

const FEED_CONTENT_TYPE = 'application/rss+xml; charset=utf-8'

export const dynamic = 'force-static'
export const revalidate = false

export async function GET() {
  const { articles, error } = await loadPublishedArticles({ limit: 50 })

  if (error) {
    return new Response('Failed to load articles', { status: 500 })
  }

  const items = articles
    .filter((article) => article.slug)
    .map((article) => {
      const link = `${SITE_URL}/articles/${article.slug}`

      return [
        '<item>',
        `<title>${escapeXml(article.title)}</title>`,
        `<link>${escapeXml(link)}</link>`,
        `<description>${escapeXml(article.content.slice(0, 200))}</description>`,
        `<pubDate>${formatRssDate(article.published_at)}</pubDate>`,
        `<category>${escapeXml(article.category ?? '')}</category>`,
        '</item>',
      ].join('')
    })
    .join('')

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    '<channel>',
    '<title>FEEL THE DROP</title>',
    `<link>${SITE_URL}</link>`,
    '<description>한국어 EDM 뉴스 종합</description>',
    '<language>ko</language>',
    items,
    '</channel>',
    '</rss>',
  ].join('')

  return new Response(xml, {
    headers: {
      'Content-Type': FEED_CONTENT_TYPE,
    },
  })
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function formatRssDate(value: string | null) {
  if (!value) return ''

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  return date.toUTCString()
}
