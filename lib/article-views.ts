import { fetchPageViews } from '@/lib/cloudflare-analytics'
import { supabaseAdmin } from '@/lib/supabase-admin'

export function parseArticleSlug(requestPath: string): string | null {
  try {
    const pathname = new URL(requestPath, 'https://feel-the-drop.invalid').pathname
    const match = pathname.match(/^\/articles\/([^/]+)\/?$/)
    if (!match) return null

    const slug = decodeURIComponent(match[1]).trim()
    return slug.length > 0 ? slug : null
  } catch {
    return null
  }
}

export async function syncArticleViews(): Promise<{ synced: number; skipped: number }> {
  try {
    const pageViews = await fetchPageViews()
    const viewsBySlug = new Map<string, number>()
    let skipped = 0

    for (const pageView of pageViews) {
      const slug = parseArticleSlug(pageView.path)
      if (!slug) {
        skipped++
        continue
      }
      viewsBySlug.set(slug, (viewsBySlug.get(slug) ?? 0) + pageView.views)
    }

    if (viewsBySlug.size === 0) return { synced: 0, skipped }

    const updatedAt = new Date().toISOString()
    const rows = Array.from(viewsBySlug, ([slug, views_30d]) => ({
      slug,
      views_30d,
      updated_at: updatedAt,
    }))
    const { error } = await supabaseAdmin
      .from('article_views')
      .upsert(rows, { onConflict: 'slug' })

    if (error) {
      console.error('[Article Views] upsert 실패:', error)
      return { synced: 0, skipped: 0 }
    }
    return { synced: rows.length, skipped }
  } catch (error) {
    console.error('[Article Views] 동기화 실패:', error)
    return { synced: 0, skipped: 0 }
  }
}
