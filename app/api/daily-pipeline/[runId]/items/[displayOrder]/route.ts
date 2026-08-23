import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { deleteDraftArticle } from '@/lib/article-delete-service'
import { isValidDailyDeleteRequest, validateDailyDeleteState } from '@/lib/daily-delete'
import { finalizeDailyDeploy } from '@/lib/daily-deploy'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ runId: string; displayOrder: string }> },
) {
  const { runId, displayOrder: rawDisplayOrder } = await params
  const displayOrder = Number(rawDisplayOrder)
  if (!isValidDailyDeleteRequest(runId, displayOrder)) {
    return NextResponse.json({ error: '유효한 run ID와 표시 번호가 필요합니다.' }, { status: 400 })
  }

  const { data: run, error: runError } = await supabase.from('daily_pipeline_runs')
    .select('id, status').eq('id', runId).maybeSingle()
  if (runError) return NextResponse.json({ error: runError.message }, { status: 500 })
  if (!run || !['succeeded', 'partial'].includes(run.status)) {
    return NextResponse.json({ error: '완료된 일일 실행을 찾을 수 없습니다.' }, { status: 404 })
  }

  const { data: item, error: itemError } = await supabase.from('daily_pipeline_items')
    .select('id, status, article_id').eq('run_id', runId).eq('display_order', displayOrder).maybeSingle()
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 })
  if (!item || item.status !== 'done' || !item.article_id) {
    return NextResponse.json({ error: '해당 실행의 삭제 가능한 기사 번호가 아닙니다.' }, { status: 409 })
  }

  const { data: article, error: articleError } = await supabase.from('articles')
    .select('id, published').eq('id', item.article_id).maybeSingle()
  if (articleError) return NextResponse.json({ error: articleError.message }, { status: 500 })
  const stateError = validateDailyDeleteState({
    runStatus: run.status,
    itemStatus: item.status,
    articleId: item.article_id,
    articlePublished: article?.published ?? null,
  })
  if (stateError) return NextResponse.json({ error: stateError }, { status: 409 })

  const deleted = await deleteDraftArticle(item.article_id)
  if (!deleted.deleted) return NextResponse.json(deleted.body, { status: deleted.status })

  const { error: updateError } = await supabase.from('daily_pipeline_items')
    .update({ status: 'deleted', article_id: null, updated_at: new Date().toISOString() })
    .eq('id', item.id).eq('status', 'done')
  if (updateError) {
    return NextResponse.json({ error: `기사는 삭제됐지만 일일 이력 갱신에 실패했습니다: ${updateError.message}` }, { status: 500 })
  }
  const deploy = await finalizeDailyDeploy(runId)
  return NextResponse.json({ success: true, deleted: true, runId, displayOrder, deploy })
}
