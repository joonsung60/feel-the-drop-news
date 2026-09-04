import { loadPublishedArticles } from '@/lib/articles'
import { createArticleExcerpt } from '@/lib/excerpt'
import { getArticleUrl, RSS_URL, SITE_URL } from '@/lib/site'

const FEED_CONTENT_TYPE = 'application/rss+xml; charset=utf-8'

export const dynamic = 'force-static'
export const revalidate = false

export async function GET() {
  const { articles, error } = await loadPublishedArticles({ limit: 50 })

  if (error) {
    return new Response('Failed to load articles', { status: 500 })
  }

  const items = articles
    .map((article) => {
      const link = getArticleUrl(article)
      const pubDate = formatRssDate(article.published_at)
      const category = article.category?.trim()

      return [
        '<item>',
        `<title>${escapeXml(article.title)}</title>`,
        `<link>${escapeXml(link)}</link>`,
        `<guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `<description>${escapeXml(createArticleExcerpt(article.content, undefined, article.content_blocks))}</description>`,
        ...(pubDate ? [`<pubDate>${escapeXml(pubDate)}</pubDate>`] : []),
        ...(category ? [`<category>${escapeXml(category)}</category>`] : []),
        '</item>',
      ].join('')
    })
    .join('')

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    '<title>FEEL THE DROP</title>',
    `<link>${escapeXml(`${SITE_URL}/`)}</link>`,
    `<atom:link href="${escapeXml(RSS_URL)}" rel="self" type="application/rss+xml" />`,
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

function formatRssDate(value: string | null): string | null {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return date.toUTCString()
}
