import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

const MAX_LIMIT = 100
const SEARCH_MAX_LIMIT = 20

function escapeIlike(value: string): string {
  return value.replace(/[\\%_,]/g, (ch) => `\\${ch}`)
}

export async function GET(req: NextRequest) {
  const published = req.nextUrl.searchParams.get('published')
  const search = req.nextUrl.searchParams.get('search')?.trim() ?? ''
  const limitParam = Number(req.nextUrl.searchParams.get('limit') ?? 50)
  const baseLimit = Number.isFinite(limitParam)
    ? Math.min(Math.max(Math.trunc(limitParam), 1), MAX_LIMIT)
    : 50
  const limit = search ? Math.min(baseLimit, SEARCH_MAX_LIMIT) : baseLimit

  let query = supabase
    .from('articles')
    .select('id, title, content, published, published_at, created_at, updated_at, cluster_id, image_url, slug, category, genre')
    .limit(limit)

  if (published === 'true' || published === 'false') {
    query = query.eq('published', published === 'true')
  }

  if (search) {
    const pattern = `%${escapeIlike(search)}%`
    query = query.or(`title.ilike.${pattern},slug.ilike.${pattern}`)
  }

  query =
    published === 'true'
      ? query.order('published_at', { ascending: false, nullsFirst: false })
      : query.order('created_at', { ascending: false })

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ articles: data ?? [] })
}
