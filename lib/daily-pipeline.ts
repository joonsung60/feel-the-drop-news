export type PublishSelectionValidation =
  | { ok: true; numbers: number[] }
  | { ok: false; error: string }

export function parsePublishNumbers(input: string): number[] | null {
  if (!/^[1-9]\d*(,[1-9]\d*)*$/.test(input)) return null
  const numbers = input.split(',').map(Number)
  return new Set(numbers).size === numbers.length ? numbers : null
}

export function validatePublishSelection(
  input: string,
  availableNumbers: ReadonlySet<number>,
): PublishSelectionValidation {
  const numbers = parsePublishNumbers(input)
  if (!numbers) {
    return { ok: false, error: '형식이 올바르지 않습니다. 예: /publish 1,3,5' }
  }
  const unavailable = numbers.find((number) => !availableNumbers.has(number))
  if (unavailable !== undefined) {
    return { ok: false, error: `${unavailable}번은 현재 활성 실행에서 게시할 수 없습니다.` }
  }
  return { ok: true, numbers }
}

export type JobSnapshot = {
  id: string
  status: string
  result: unknown
  error_message: string | null
}

export type AggregatedJob = {
  jobId: string
  status: 'processing' | 'done' | 'failed'
  articleId: string | null
  articleTitle: string | null
  error: string | null
}

export function aggregateJob(snapshot: JobSnapshot): AggregatedJob {
  if (snapshot.status === 'failed') {
    return {
      jobId: snapshot.id,
      status: 'failed',
      articleId: null,
      articleTitle: null,
      error: snapshot.error_message || '알 수 없는 생성 오류',
    }
  }
  if (snapshot.status !== 'done') {
    return {
      jobId: snapshot.id,
      status: 'processing',
      articleId: null,
      articleTitle: null,
      error: null,
    }
  }
  const result = snapshot.result && typeof snapshot.result === 'object'
    ? snapshot.result as Record<string, unknown>
    : {}
  const article = result.article && typeof result.article === 'object'
    ? result.article as Record<string, unknown>
    : null
  const articleId = typeof article?.id === 'string' ? article.id : null
  if (!articleId) {
    return {
      jobId: snapshot.id,
      status: 'failed',
      articleId: null,
      articleTitle: null,
      error: '완료된 job 결과에 article ID가 없습니다.',
    }
  }
  return {
    jobId: snapshot.id,
    status: 'done',
    articleId,
    articleTitle: typeof article?.title === 'string' ? article.title : null,
    error: null,
  }
}

export function classifyRun(selected: number, succeeded: number, failed: number) {
  if (selected === 0) return 'succeeded' as const
  if (succeeded === 0 && failed > 0) return 'failed' as const
  if (failed > 0 || succeeded < selected) return 'partial' as const
  return 'succeeded' as const
}

export function hasQueuedJobs(items: ReadonlyArray<{ job_id: string | null }>): boolean {
  return items.some((item) => Boolean(item.job_id))
}

export const DAILY_RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type DailyPipelineMode =
  | { kind: 'normal'; retryFailed: boolean }
  | { kind: 'notify-only'; runId: string }
  | { kind: 'resume-run'; runId: string }

export function parseDailyPipelineMode(args: string[]): DailyPipelineMode {
  if (args.length === 0) return { kind: 'normal', retryFailed: false }
  if (args.length === 1 && args[0] === '--retry-failed') {
    return { kind: 'normal', retryFailed: true }
  }
  if (args.length === 2 && args[0] === '--notify-only' && DAILY_RUN_ID_PATTERN.test(args[1])) {
    return { kind: 'notify-only', runId: args[1] }
  }
  if (args.length === 2 && args[0] === '--resume-run' && DAILY_RUN_ID_PATTERN.test(args[1])) {
    return { kind: 'resume-run', runId: args[1] }
  }
  throw new Error(
    '사용법: daily-pipeline.ts [--retry-failed | --notify-only <run-id> | --resume-run <run-id>]',
  )
}

export type ResumeCandidate = {
  id: string
  run_date: string
  status: string
  completed_at: string | null
  runner_lock_token: string | null
  runner_lease_expires_at: string | null
  clear_result: unknown
  collect_result: unknown
  suggest_result: unknown
  selected_count: number
}

export function assertResumeCandidate(
  run: ResumeCandidate,
  requestedRunId: string,
  now = new Date(),
): void {
  if (run.id !== requestedRunId) {
    throw new Error(`resume acquire run ID 불일치: requested=${requestedRunId} acquired=${run.id}`)
  }
  if (run.completed_at || ['succeeded', 'partial'].includes(run.status)) {
    throw new Error(`완료된 daily run은 resume할 수 없습니다: ${run.id} (${run.status})`)
  }
  if (run.status !== 'waiting') {
    throw new Error(`waiting 상태의 daily run만 resume할 수 있습니다: ${run.id} (${run.status})`)
  }
  if (run.runner_lock_token || run.runner_lease_expires_at) {
    if (!run.runner_lease_expires_at) {
      throw new Error(`daily run lock은 있지만 lease 만료 시각이 없습니다: ${run.id}`)
    }
    const leaseExpiresAt = new Date(run.runner_lease_expires_at)
    if (Number.isNaN(leaseExpiresAt.getTime())) {
      throw new Error(`daily run lease 만료 시각이 유효하지 않습니다: ${run.id}`)
    }
    if (leaseExpiresAt.getTime() >= now.getTime()) {
      throw new Error(`daily run lease가 아직 유효합니다: ${run.id} (${run.runner_lease_expires_at})`)
    }
  }
  if (!run.clear_result || !run.collect_result || !run.suggest_result) {
    throw new Error(`resume에 필요한 기존 단계 결과가 없습니다: ${run.id}`)
  }
  if (!Number.isInteger(run.selected_count) || run.selected_count < 1) {
    throw new Error(`resume할 기존 선택 item이 없습니다: ${run.id}`)
  }
}
