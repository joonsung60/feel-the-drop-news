import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { triggerDeployHook } from '@/lib/deploy-hook'

function normalizeArticleInput(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeOptionalInput(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const normalized = typeof value === 'string' ? value.trim() : ''
  return normalized.length > 0 ? normalized : null
}

type ClusterArticleRow = {
  raw_article_id: string
}

async function resetClusterRawArticlesForDraftDelete(clusterId: string): Promise<string | null> {
  const { data: clusterArticles, error: clusterError } = await supabase
    .from('cluster_articles')
    .select('raw_article_id')
    .eq('cluster_id', clusterId)

  if (clusterError) return clusterError.message

  const rawArticleIds = Array.from(new Set(
    ((clusterArticles ?? []) as ClusterArticleRow[])
      .map((row) => row.raw_article_id)
      .filter(Boolean)
  ))

  if (rawArticleIds.length === 0) return null

  const { error: rawUpdateError } = await supabase
    .from('raw_articles')
    .update({
      suggestion_state: 'new',
      suggestion_used_at: null,
    })
    .in('id', rawArticleIds)

  return rawUpdateError?.message ?? null
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
    .update({ title, content, category, genre, updated_at: new Date().toISOString() })
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

  const { data: article, error: fetchError } = await supabase
    .from('articles')
    .select('id, title, published, cluster_id')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!article) {
    return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 })
  }

  if (article.published) {
    return NextResponse.json(
      { error: '게시된 기사는 이 화면에서 삭제할 수 없습니다.' },
      { status: 400 }
    )
  }

  if (article.cluster_id) {
    const rawArticleUpdateError = await resetClusterRawArticlesForDraftDelete(article.cluster_id)
    if (rawArticleUpdateError) {
      console.error('[delete draft] raw_articles suggestion_state 초기화 실패:', rawArticleUpdateError)
      return NextResponse.json({ error: rawArticleUpdateError }, { status: 500 })
    }
  }

  const { error: imageSourceUpdateError } = await supabase
    .from('image_sources')
    .update({
      generated_article_id: null,
      status: 'analyzed',
    })
    .eq('generated_article_id', id)

  if (imageSourceUpdateError) {
    return NextResponse.json({ error: imageSourceUpdateError.message }, { status: 500 })
  }

  const { error: deleteError } = await supabase
    .from('articles')
    .delete()
    .eq('id', id)

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: true, article })
}
