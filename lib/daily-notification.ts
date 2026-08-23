export type NotificationRun = {
  id: string
  run_date: string
  status: string
  selected_count: number
  success_count: number
  failure_count: number
  completed_at: string | null
  collect_result: Record<string, unknown> | null
  clear_result: Record<string, unknown> | null
}

export type NotificationItem = {
  status: string
  article_id: string | null
  article_title: string | null
  selection_order: number
  display_order: number | null
}

export function shouldNotifyWorkerForJob(payload: Record<string, unknown> | null): boolean {
  return typeof payload?.dailyPipelineRunId !== 'string' || payload.dailyPipelineRunId.length === 0
}

export function prepareDailyNotification(run: NotificationRun, items: NotificationItem[]) {
  if (run.status !== 'succeeded' && run.status !== 'partial') {
    throw new Error(`알림 재전송은 succeeded/partial 실행만 허용합니다: ${run.status}`)
  }
  if (!run.completed_at) throw new Error('완료 시각이 없는 실행에는 알림을 재전송할 수 없습니다.')
  if (items.length !== run.selected_count) {
    throw new Error(`일일 실행 결과가 불완전합니다: selected ${run.selected_count}, items ${items.length}`)
  }
  if (items.some((item) => item.status !== 'done' && item.status !== 'failed')) {
    throw new Error('종료되지 않은 일일 item이 있어 알림을 재전송할 수 없습니다.')
  }

  const succeeded = items
    .filter((item) => item.status === 'done')
    .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
  const failed = items.filter((item) => item.status === 'failed')

  if (succeeded.length !== run.success_count || failed.length !== run.failure_count) {
    throw new Error('run 성공/실패 집계와 item 결과가 일치하지 않습니다.')
  }
  if (succeeded.some((item) => !item.article_id || !Number.isInteger(item.display_order))) {
    throw new Error('성공 item에 article_id 또는 display_order가 없습니다.')
  }
  if (failed.some((item) => item.display_order !== null)) {
    throw new Error('실패 item에 display_order가 지정되어 있습니다.')
  }
  for (const [index, item] of succeeded.entries()) {
    if (item.display_order !== index + 1) {
      throw new Error('display_order가 1부터 연속적이지 않습니다.')
    }
  }
  if (succeeded.length === 0) throw new Error('재전송할 성공 초안이 없습니다.')

  return { succeeded, failed }
}
