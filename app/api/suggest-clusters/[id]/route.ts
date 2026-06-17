import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

const ALLOWED_STATUSES = new Set(['pending', 'approved', 'rejected', 'published'])

type SuggestedClusterRow = {
  article_ids?: string[] | null
}

async function updateRawArticleSuggestionState(
  articleIds: string[],
  updates: Record<string, string | null>
): Promise<string | null> {
  if (articleIds.length === 0) return null

  const { error } = await supabase
    .from('raw_articles')
    .update(updates)
    .in('id', articleIds)

  return error?.message ?? null
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    
    // rawArticleId가 있으면 원문 기사 상태만 업데이트
    if (body.rawArticleId) {
      const { error } = await supabase
        .from('raw_articles')
        .update({ suggestion_state: 'ignored' })
        .eq('id', body.rawArticleId)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }

      return NextResponse.json({ success: true })
    }

    const updates: Record<string, string | null> = {}
    let nextStatus: string | null = null

    if (typeof body.status === 'string') {
      if (!ALLOWED_STATUSES.has(body.status)) {
        return NextResponse.json(
          { error: `유효하지 않은 status: ${body.status}` },
          { status: 400 }
        )
      }
      updates.status = body.status
      nextStatus = body.status
    }

    if (body.clusterId === null || typeof body.clusterId === 'string') {
      updates.cluster_id = body.clusterId
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '업데이트할 필드가 없습니다.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('suggested_clusters')
      .update(updates)
      .eq('id', id)
      .select()
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: '제안을 찾을 수 없습니다.' }, { status: 404 })
    }

    const articleIds = Array.isArray((data as SuggestedClusterRow).article_ids)
      ? (data as SuggestedClusterRow).article_ids ?? []
      : []
    const now = new Date().toISOString()
    let rawArticleUpdateError: string | null = null

    if (nextStatus === 'rejected' && body.hideRawArticles === true) {
      rawArticleUpdateError = await updateRawArticleSuggestionState(articleIds, {
        suggestion_state: 'ignored',
        suggestion_rejected_at: now,
      })
    }

    if (rawArticleUpdateError) {
      console.error('[suggest-clusters] raw_articles suggestion_state 업데이트 실패:', rawArticleUpdateError)
      return NextResponse.json({ suggestion: data, rawArticleUpdateError }, { status: 500 })
    }

    return NextResponse.json({ suggestion: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
