import { NextResponse } from 'next/server'
import { finalizeDailyDeploy } from '@/lib/daily-deploy'
import { DAILY_RUN_ID_PATTERN } from '@/lib/daily-pipeline'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params
  if (!DAILY_RUN_ID_PATTERN.test(runId)) {
    return NextResponse.json({ error: '유효한 run ID가 필요합니다.' }, { status: 400 })
  }
  try {
    const deploy = await finalizeDailyDeploy(runId, true)
    if (deploy.status === 'not_claimed') {
      return NextResponse.json({ error: '재시도 가능한 실패 상태가 아니거나 아직 모든 항목이 처리되지 않았습니다.' }, { status: 409 })
    }
    if (deploy.status === 'failed') {
      return NextResponse.json({ error: deploy.error, deploy }, { status: 502 })
    }
    return NextResponse.json({ success: true, deploy })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
