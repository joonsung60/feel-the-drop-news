import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { parsePublishNumbers } from '@/lib/daily-pipeline'
import { finalizeDailyDeploy } from '@/lib/daily-deploy'
import { executePreparedPublishBatch, isPublishError, prepareArticlePublish, type PreparedPublish } from '@/lib/publish-service'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { runId?: unknown; numbers?: unknown }
  const runId = typeof body.runId === 'string' ? body.runId : ''
  const numbers = typeof body.numbers === 'string' ? parsePublishNumbers(body.numbers) : null
  if (!runId || !numbers) return NextResponse.json({ error: 'runId와 엄격한 numbers 형식(예: 1,3,5)이 필요합니다.' }, { status: 400 })

  const { data: latestRun, error: runError } = await supabase.from('daily_pipeline_runs')
    .select('id').in('status', ['succeeded', 'partial']).order('run_date', { ascending: false })
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (runError) return NextResponse.json({ error: runError.message }, { status: 500 })
  if (!latestRun || latestRun.id !== runId) return NextResponse.json({ error: '현재 활성 일일 실행이 아닙니다.' }, { status: 409 })

  const { data: items, error: itemError } = await supabase.from('daily_pipeline_items')
    .select('display_order, article_id').eq('run_id', runId).eq('status', 'done')
    .not('article_id', 'is', null).in('display_order', numbers)
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 })
  const byNumber = new Map((items ?? []).map((item) => [item.display_order as number, item.article_id as string]))
  if (numbers.some((number) => !byNumber.get(number))) return NextResponse.json({ error: '범위 밖이거나 다른 실행에 속한 번호가 있습니다.' }, { status: 409 })

  const prepared: PreparedPublish[] = []
  for (const number of numbers) {
    const result = await prepareArticlePublish(byNumber.get(number)!)
    if (isPublishError(result)) return NextResponse.json({ number, ...result.body }, { status: result.status })
    prepared.push(result)
  }
  const batch = await executePreparedPublishBatch(prepared, { runId, displayOrders: numbers })
  if (batch.error) {
    return NextResponse.json({ error: `일괄 게시가 취소되었습니다: ${batch.error}` }, { status: 409 })
  }
  const deploy = await finalizeDailyDeploy(runId)
  const deployWarning = deploy.status === 'failed'
    ? '기사 게시에는 성공했지만 최종 Cloudflare 배포에 실패했습니다. Telegram의 재시도 안내를 확인하세요.'
    : null
  return NextResponse.json({ success: true, published: batch.articles, deploy, deployWarning })
}
