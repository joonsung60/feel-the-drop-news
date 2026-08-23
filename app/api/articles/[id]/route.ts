import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { triggerDeployHook } from '@/lib/deploy-hook'
import { deleteDraftArticle } from '@/lib/article-delete-service'

function normalizeArticleInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalInput(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const title = normalizeArticleInput(body.title)
  const content = normalizeArticleInput(body.content)
  const category = normalizeOptionalInput(body.category)
  const genre = normalizeOptionalInput(body.genre)

  if (title.length < 4) {
    return NextResponse.json({ error: '제목이 너무 짧습니다.' }, { status: 400 })
  }

  if (content.length < 80) {
    return NextResponse.json({ error: '본문이 너무 짧습니다.' }, { status: 400 })
  }

  const { data: existing, error: fetchError } = await supabase
    .from('articles')
    .select('id, published')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!existing) {
    return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 })
  }

  const { data, error } = await supabase
    .from('articles')
    .update({ title, content, content_blocks: null, category, genre, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('id, title, content, published, published_at, created_at, updated_at, cluster_id, image_url, slug, category, genre')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (existing.published) {
    await triggerDeployHook()
  }

  return NextResponse.json({ article: data })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  }

  const result = await deleteDraftArticle(id)
  return NextResponse.json(result.body, { status: result.status })
}
