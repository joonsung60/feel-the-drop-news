import { NextRequest, NextResponse } from 'next/server'
import { authorizeAdminRequest } from '@/lib/admin-api-auth'
import { validateEditorialArticleInput } from '@/lib/editorial-article-input'
import { createEditorialDraft } from '@/lib/editorial-article-service'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

const ARTICLE_SELECT =
  'id, title, content, content_blocks, published, published_at, created_at, updated_at, cluster_id, image_url, cover_image_mode, cover_image_path, show_cover_in_article, slug, category, genre'

export async function POST(request: NextRequest) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response
  const body = await request.json().catch(() => null)
  const validated = validateEditorialArticleInput(body)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })
  if (validated.input.slug) {
    const { data: duplicate, error: duplicateError } = await supabase.from('articles')
      .select('id').eq('slug', validated.input.slug).maybeSingle()
    if (duplicateError) return NextResponse.json({ error: duplicateError.message }, { status: 500 })
    if (duplicate) return NextResponse.json({ error: '이미 사용 중인 slug입니다.', code: 'SLUG_CONFLICT' }, { status: 409 })
  }

  const result = await createEditorialDraft(validated.input, async (payload) => {
    const { data, error } = await supabase.from('articles').insert(payload).select(ARTICLE_SELECT).single()
    return { data, error: error?.message ?? null }
  })
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ article: result.data }, { status: 201 })
}
