import { NextRequest, NextResponse } from 'next/server'
import { extractArticleTitle, isUrlLikeTitle } from '@/lib/article-extraction'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

const REQUEST_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'User-Agent': 'Mozilla/5.0 EDM Star News Title Backfill',
}

type RawArticleTitleRow = {
  id: string
  title: string | null
  url: string
}

async function fetchTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: REQUEST_HEADERS,
      signal: AbortSignal.timeout(10000),
    })
    const html = await res.text()
    return extractArticleTitle(html, url)
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const dryRun = body.dryRun !== false
  const limit = typeof body.limit === 'number' && body.limit > 0
    ? Math.min(Math.trunc(body.limit), 100)
    : 30

  const { data, error } = await supabase
    .from('raw_articles')
    .select('id, title, url')
    .or('title.ilike.http%,title.ilike.https%,title.ilike.www.%')
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = ((data ?? []) as RawArticleTitleRow[])
    .filter((row) => row.title && isUrlLikeTitle(row.title))

  const results = []

  for (const row of rows) {
    const newTitle = await fetchTitle(row.url)
    const changed = Boolean(newTitle && newTitle !== row.title)

    if (changed && !dryRun) {
      const { error: updateError } = await supabase
        .from('raw_articles')
        .update({ title: newTitle })
        .eq('id', row.id)

      if (updateError) {
        results.push({
          id: row.id,
          url: row.url,
          oldTitle: row.title,
          newTitle,
          updated: false,
          error: updateError.message,
        })
        continue
      }
    }

    results.push({
      id: row.id,
      url: row.url,
      oldTitle: row.title,
      newTitle,
      updated: changed && !dryRun,
      wouldUpdate: changed && dryRun,
    })
  }

  return NextResponse.json({
    dryRun,
    checked: rows.length,
    updatable: results.filter((result) => result.newTitle && result.newTitle !== result.oldTitle).length,
    results,
  })
}
