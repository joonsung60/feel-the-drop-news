import { randomUUID } from 'node:crypto'
import { loadEnvConfig } from '@next/env'
import { createClient } from '@supabase/supabase-js'
import {
  aggregateJob,
  assertResumeCandidate,
  classifyRun,
  hasQueuedJobs,
  parseDailyPipelineMode,
  type ResumeCandidate,
} from '../lib/daily-pipeline'
import { prepareDailyNotification, type NotificationItem, type NotificationRun } from '../lib/daily-notification'
import { sendTelegramMessage } from '../lib/telegram'
import { buildArticleCardMessage } from '../lib/telegram-article-card'
import { formatErrorWithCause, requestWithExplicitTimeout } from '../lib/long-running-http'

loadEnvConfig(process.cwd())

const API_BASE_URL = process.env.LOCAL_API ?? 'http://127.0.0.1:3001'
const AUTO_DRAFT_LIMIT = positiveInteger(process.env.AUTO_DRAFT_LIMIT, 15)
const HTTP_TIMEOUT_MS = positiveInteger(process.env.DAILY_PIPELINE_HTTP_TIMEOUT_MS, 20 * 60_000)
const JOB_TIMEOUT_MS = positiveInteger(process.env.DAILY_PIPELINE_JOB_TIMEOUT_MS, 3 * 60 * 60_000)
const POLL_INTERVAL_MS = positiveInteger(process.env.DAILY_PIPELINE_POLL_INTERVAL_MS, 5_000)
const READINESS_TIMEOUT_MS = positiveInteger(process.env.DAILY_PIPELINE_READINESS_TIMEOUT_MS, 5 * 60_000)
const RUNNER_LEASE_SECONDS = Math.ceil((JOB_TIMEOUT_MS + 60 * 60_000) / 1000)
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434'
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const botToken = process.env.BOT_TOKEN
const chatIds = (process.env.ALLOWED_USERS ?? '').split(',').map((id) => id.trim()).filter(Boolean)

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL(NEXT_PUBLIC_SUPABASE_URL) 및 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.')
}
if (!botToken || chatIds.length === 0) {
  throw new Error('BOT_TOKEN 및 ALLOWED_USERS가 필요합니다.')
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

type RunRow = {
  id: string
  run_date: string
  status: string
  ingestion_run_id: string | null
  collect_result: Record<string, unknown> | null
  clear_result: Record<string, unknown> | null
  suggest_result: Record<string, unknown> | null
  selected_count: number
  completed_at: string | null
  runner_lock_token: string | null
  runner_lease_expires_at: string | null
}

type Suggestion = { id: string; topic?: string | null }
type ItemRow = { id: string; job_id: string | null; selection_order: number }

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

function koreanDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

async function apiJson(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await requestWithExplicitTimeout(`${API_BASE_URL}${path}`, {
    method: init.method,
    headers: init.headers,
    body: typeof init.body === 'string' ? init.body : undefined,
    timeoutMs: HTTP_TIMEOUT_MS,
    label: `${init.method ?? 'GET'} ${path}`,
  })
  const text = await response.text()
  let body: Record<string, unknown> = {}
  try {
    body = text ? JSON.parse(text) as Record<string, unknown> : {}
  } catch {
    throw new Error(`${path} 응답이 JSON이 아닙니다. HTTP ${response.status}: ${text.slice(0, 500)}`)
  }
  if (!response.ok) {
    throw new Error(`${path} HTTP ${response.status}: ${JSON.stringify(body).slice(0, 1000)}`)
  }
  return body
}

async function waitForUrl(label: string, url: string): Promise<void> {
  const deadline = Date.now() + READINESS_TIMEOUT_MS
  let lastError = '응답 없음'
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5_000) })
      if (response.ok) return
      lastError = `HTTP ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  throw new DOMException(`${label} readiness timeout: ${lastError}`, 'TimeoutError')
}

async function waitForDependencies(): Promise<void> {
  await waitForUrl('Next API', `${API_BASE_URL}/api/articles?limit=1`)
  await waitForUrl('Ollama', `${OLLAMA_BASE_URL}/api/tags`)
}

async function updateRun(runId: string, lockToken: string, values: Record<string, unknown>) {
  const { data, error } = await supabase.from('daily_pipeline_runs')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', runId)
    .eq('runner_lock_token', lockToken)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`daily run lease를 잃었습니다: ${runId}`)
}

async function notify(text: string, replyMarkup?: Record<string, unknown>): Promise<void> {
  for (const chatId of chatIds) {
    await sendTelegramMessage(botToken!, chatId, text, replyMarkup)
  }
}

async function notifyRun(runId: string, mode: 'normal' | 'notify-only'): Promise<void> {
  const { data: run, error: runError } = await supabase.from('daily_pipeline_runs')
    .select('id, run_date, status, selected_count, success_count, failure_count, completed_at, collect_result, clear_result')
    .eq('id', runId)
    .maybeSingle()
  if (runError) throw runError
  if (!run) throw new Error(`일일 실행을 찾을 수 없습니다: ${runId}`)

  const { data: items, error: itemsError } = await supabase.from('daily_pipeline_items')
    .select('status, article_id, article_title, selection_order, display_order')
    .eq('run_id', runId)
    .order('selection_order', { ascending: true })
  if (itemsError) throw itemsError

  const prepared = prepareDailyNotification(
    run as NotificationRun,
    (items ?? []) as NotificationItem[],
  )
  const articleIds = prepared.succeeded.map((item) => item.article_id).filter((id): id is string => Boolean(id))
  const { data: articles, error: articleError } = await supabase.from('articles')
    .select('id, title, content, published').in('id', articleIds)
  if (articleError) throw articleError
  const articleById = new Map((articles ?? []).map((article) => [article.id as string, article]))
  if (articleById.size !== articleIds.length) {
    throw new Error('성공 item의 기사 본문이 일부 누락되어 알림을 전송하지 않습니다.')
  }
  const clearResult = run.clear_result as Record<string, unknown> | null
  const collectResult = run.collect_result as Record<string, unknown> | null
  const failures = Array.isArray(collectResult?.failures)
    ? collectResult.failures as Record<string, unknown>[]
    : []
  const titles = prepared.succeeded
    .map((item) => `${item.display_order}. ${item.article_title ?? item.article_id}`)
    .join('\n')
  const rssFailures = failures.length
    ? failures.map((failure) => `- ${failure.source ?? '알 수 없는 소스'}: ${failure.error ?? '오류'}`).join('\n')
    : '없음'

  await notify(
    `📰 일일 초안 생성 ${run.status}\n성공 ${prepared.succeeded.length} / 실패 ${prepared.failed.length}\n정리: pending ${clearResult?.deleted ?? 0}개 삭제, raw article ${clearResult?.resetRawArticles ?? 0}개 초기화\n\n${titles}\n\nRSS 실패 소스\n${rssFailures}`,
  )
  for (const item of prepared.succeeded) {
    const article = articleById.get(item.article_id!)!
    if (article.published) throw new Error(`${item.display_order}번 기사가 이미 게시되어 알림을 전송하지 않습니다.`)
    const message = buildArticleCardMessage({
      displayOrder: item.display_order,
      title: article.title ?? item.article_title ?? item.article_id,
      content: article.content,
    },
      `daily_publish:${run.id}:${item.display_order}`,
      `daily_delete:${run.id}:${item.display_order}`,
    )
    await notify(message.text, message.replyMarkup)
  }
  const label = mode === 'notify-only' ? '기존 실행 Telegram 알림 재전송 완료' : 'Telegram 완료 알림 전송 완료'
  console.log(`[daily-pipeline] ${label}: ${run.id} (${prepared.succeeded.length}개)`)
}

async function acquireRun(
  runDate: string,
  lockToken: string,
  allowTerminalRetry: boolean,
): Promise<RunRow | null> {
  const { data, error } = await supabase.rpc('acquire_daily_pipeline_run', {
    requested_run_date: runDate,
    requested_lock_token: lockToken,
    requested_lease_seconds: RUNNER_LEASE_SECONDS,
    allow_terminal_retry: allowTerminalRetry,
  })
  if (error) throw error
  return ((data ?? []) as RunRow[])[0] ?? null
}

async function enqueue(run: RunRow, suggestions: Suggestion[], lockToken: string): Promise<ItemRow[]> {
  await updateRun(run.id, lockToken, { status: 'enqueueing', selected_count: suggestions.length })
  const items: ItemRow[] = []
  for (const [index, suggestion] of suggestions.entries()) {
    const { data: item, error: itemError } = await supabase.from('daily_pipeline_items')
      .upsert({
        run_id: run.id,
        suggestion_id: suggestion.id,
        suggestion_title: suggestion.topic ?? null,
        selection_order: index + 1,
      }, { onConflict: 'run_id,suggestion_id' })
      .select('id, job_id, selection_order')
      .single()
    if (itemError) throw itemError

    let jobId = item.job_id as string | null
    if (!jobId) {
      try {
        const job = await apiJson('/api/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            job_type: 'generate_from_suggestion',
            payload: { suggestionId: suggestion.id, dailyPipelineRunId: run.id },
            idempotency_key: `daily:${run.id}:suggestion:${suggestion.id}`,
          }),
        })
        if (typeof job.jobId !== 'string') throw new Error(`job 등록 응답에 jobId가 없습니다: ${suggestion.id}`)
        jobId = job.jobId
        const { error } = await supabase.from('daily_pipeline_items')
          .update({ job_id: jobId, status: 'queued', updated_at: new Date().toISOString() })
          .eq('id', item.id)
          .is('job_id', null)
        if (error) throw error
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await supabase.from('daily_pipeline_items').update({
          status: 'failed', error_message: message, updated_at: new Date().toISOString(),
        }).eq('id', item.id)
      }
    }
    items.push({ id: item.id as string, job_id: jobId, selection_order: item.selection_order as number })
  }
  return items
}

async function waitForJobs(run: RunRow, items: ItemRow[], lockToken: string) {
  await updateRun(run.id, lockToken, { status: 'waiting' })
  if (!hasQueuedJobs(items)) return
  const deadline = Date.now() + JOB_TIMEOUT_MS
  while (Date.now() < deadline) {
    const jobIds = items.map((item) => item.job_id).filter((id): id is string => Boolean(id))
    const { data, error } = await supabase.from('job_queue')
      .select('id, status, result, error_message')
      .in('id', jobIds)
    if (error) throw error
    const byId = new Map((data ?? []).map((job) => [job.id as string, aggregateJob(job)]))
    let terminal = items.filter((item) => !item.job_id).length
    for (const item of items) {
      if (!item.job_id) continue
      const job = byId.get(item.job_id)
      if (!job) continue
      if (job.status === 'processing') {
        await supabase.from('daily_pipeline_items').update({ status: 'processing' }).eq('id', item.id)
        continue
      }
      terminal++
      await supabase.from('daily_pipeline_items').update({
        status: job.status,
        article_id: job.articleId,
        article_title: job.articleTitle,
        error_message: job.error,
        updated_at: new Date().toISOString(),
      }).eq('id', item.id)
    }
    if (terminal === items.length) return
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new DOMException('기사 생성 job 집계 timeout', 'TimeoutError')
}

async function finish(
  run: RunRow,
  lockToken: string,
) {
  const { data, error } = await supabase.from('daily_pipeline_items')
    .select('id, status, selection_order, article_id, article_title, error_message')
    .eq('run_id', run.id)
    .order('selection_order', { ascending: true })
  if (error) throw error
  const succeeded = (data ?? []).filter((item) => item.status === 'done' && item.article_id)
  const failed = (data ?? []).filter((item) => item.status === 'failed' || !item.article_id)
  for (const [index, item] of succeeded.entries()) {
    const { error: displayError } = await supabase.from('daily_pipeline_items')
      .update({ display_order: index + 1 }).eq('id', item.id)
    if (displayError) throw displayError
  }
  const status = classifyRun(data?.length ?? 0, succeeded.length, failed.length)
  await updateRun(run.id, lockToken, {
    status,
    success_count: succeeded.length,
    failure_count: failed.length,
    completed_at: new Date().toISOString(),
    runner_lock_token: null,
    runner_lease_expires_at: null,
  })

  try {
    await notifyRun(run.id, 'normal')
  } catch (error) {
    const message = `notification 단계 실패: ${error instanceof Error ? error.message : String(error)}`
    console.error(`[daily-pipeline] ${message}`)
    await supabase.from('daily_pipeline_runs').update({ error_message: message }).eq('id', run.id)
  }
}

async function main(allowTerminalRetry = false) {
  const runDate = koreanDate()
  const lockToken = randomUUID()
  let run: RunRow | null = null
  let failureStage: 'clear' | 'collect' | 'suggest' | 'generation' | 'notification' = 'clear'
  try {
    await waitForDependencies()
    run = await acquireRun(runDate, lockToken, allowTerminalRetry)
    if (!run) {
      console.log(`[daily-pipeline] ${runDate} 실행이 이미 진행 중이거나 완료되었습니다.`)
      return
    }

    failureStage = 'notification'
    await notify(`🚀 일일 파이프라인 시작\n날짜: ${run.run_date}\nrun: ${run.id}`).catch(async (error) => {
      const message = `notification 단계 시작 알림 실패: ${error instanceof Error ? error.message : String(error)}`
      console.error(`[daily-pipeline] ${message}`)
      await updateRun(run!.id, lockToken, { error_message: message })
    })

    failureStage = 'clear'
    let clearResult = run.clear_result
    if (!clearResult) {
      clearResult = await apiJson('/api/suggest-clusters?status=pending', { method: 'DELETE' })
      if (clearResult.success !== true || clearResult.rawArticleResetError) {
        throw new Error(`pending 정리 실패: ${JSON.stringify(clearResult)}`)
      }
      await updateRun(run.id, lockToken, { clear_result: clearResult, status: 'collecting' })
    }

    const ingestionRunId = run.ingestion_run_id ?? randomUUID()
    if (!run.ingestion_run_id) {
      await updateRun(run.id, lockToken, { ingestion_run_id: ingestionRunId, status: 'collecting' })
    }

    failureStage = 'collect'
    let collectResult = run.collect_result
    if (!collectResult) {
      collectResult = await apiJson('/api/collect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingestionRunId }),
      })
      if (collectResult.success !== true) throw new Error(`collect 실패: ${JSON.stringify(collectResult)}`)
      await updateRun(run.id, lockToken, { collect_result: collectResult, status: 'suggesting' })
    }

    failureStage = 'suggest'
    let suggestResult = run.suggest_result
    if (!suggestResult) {
      suggestResult = await apiJson('/api/suggest-clusters', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredIngestionRunId: ingestionRunId,
          dailyPipelineRunId: run.id,
        }),
      })
      if (suggestResult.error || !Array.isArray(suggestResult.suggestions)) {
        throw new Error(`Suggest 1 실패: ${JSON.stringify(suggestResult)}`)
      }
      await updateRun(run.id, lockToken, { suggest_result: suggestResult, status: 'enqueueing' })
    }

    failureStage = 'generation'
    const suggestions = (suggestResult.suggestions as Suggestion[]).slice(0, AUTO_DRAFT_LIMIT)
    const { data: existingItems, error: itemsError } = await supabase.from('daily_pipeline_items')
      .select('id, job_id, selection_order').eq('run_id', run.id).order('selection_order')
    if (itemsError) throw itemsError
    let items = existingItems && existingItems.length === suggestions.length
      ? existingItems as ItemRow[]
      : await enqueue(run, suggestions, lockToken)
    if (items.some((item) => !item.job_id)) {
      items = await enqueue(run, suggestions, lockToken)
    }
    await waitForJobs(run, items, lockToken)
    failureStage = 'notification'
    await finish(run, lockToken)
  } catch (error) {
    const detail = formatErrorWithCause(error)
    const message = `${failureStage} 단계 실패: ${detail}`
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    if (run) {
      await updateRun(run.id, lockToken, {
        status: timedOut ? 'timed_out' : 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
        runner_lock_token: null,
        runner_lease_expires_at: null,
      }).catch((updateError) => console.error('[daily-pipeline] 실패 상태 저장 오류:', updateError))
    }
    await notify(`❌ 일일 파이프라인 실패\n단계: ${failureStage}\n${detail}`).catch((notifyError) => {
      console.error('[daily-pipeline] Telegram 실패 알림 오류:', notifyError)
    })
    throw error
  }
}

async function resumeRun(requestedRunId: string): Promise<void> {
  const lockToken = randomUUID()
  let run: RunRow | null = null

  const { data: candidate, error: candidateError } = await supabase.from('daily_pipeline_runs')
    .select('id, run_date, status, ingestion_run_id, collect_result, clear_result, suggest_result, selected_count, completed_at, runner_lock_token, runner_lease_expires_at')
    .eq('id', requestedRunId)
    .maybeSingle()
  if (candidateError) throw candidateError
  if (!candidate) throw new Error(`resume할 daily run을 찾을 수 없습니다: ${requestedRunId}`)
  assertResumeCandidate(candidate as ResumeCandidate, requestedRunId)

  try {
    const acquiredRun = await acquireRun(candidate.run_date as string, lockToken, false)
    if (!acquiredRun) {
      throw new Error(`daily run lease를 acquire하지 못했습니다: ${requestedRunId}`)
    }
    if (acquiredRun.id !== requestedRunId) {
      throw new Error(`resume acquire run ID 불일치: requested=${requestedRunId} acquired=${acquiredRun.id}`)
    }
    run = acquiredRun

    const { data: existingItems, error: itemsError } = await supabase.from('daily_pipeline_items')
      .select('id, job_id, selection_order')
      .eq('run_id', run.id)
      .order('selection_order', { ascending: true })
    if (itemsError) throw itemsError
    if (!existingItems || existingItems.length !== candidate.selected_count) {
      throw new Error(
        `기존 daily item 수가 selected_count와 다릅니다: expected=${candidate.selected_count} actual=${existingItems?.length ?? 0}`,
      )
    }
    if (existingItems.some((item) => !item.job_id)) {
      throw new Error(`job ID가 없는 기존 daily item이 있습니다: ${requestedRunId}`)
    }

    const items = existingItems as ItemRow[]
    console.log(`[daily-pipeline] 기존 run 집계 재개: ${run.id} (${run.run_date}, ${items.length}개 job)`)
    await waitForJobs(run, items, lockToken)
    await finish(run, lockToken)
  } catch (error) {
    const message = formatErrorWithCause(error)
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    if (run) {
      await updateRun(run.id, lockToken, {
        status: timedOut ? 'timed_out' : 'failed',
        error_message: message,
        completed_at: new Date().toISOString(),
        runner_lock_token: null,
        runner_lease_expires_at: null,
      }).catch((updateError) => console.error('[daily-pipeline] resume 실패 상태 저장 오류:', updateError))
    }
    await notify(`❌ 일일 파이프라인 집계 재개 실패\n${message}`).catch((notifyError) => {
      console.error('[daily-pipeline] Telegram resume 실패 알림 오류:', notifyError)
    })
    throw error
  }
}

async function entrypoint(): Promise<void> {
  const mode = parseDailyPipelineMode(process.argv.slice(2))
  if (mode.kind === 'notify-only') {
    await notifyRun(mode.runId, 'notify-only')
    return
  }
  if (mode.kind === 'resume-run') {
    await resumeRun(mode.runId)
    return
  }
  await main(mode.retryFailed)
}

void entrypoint().catch((error) => {
  console.error('[daily-pipeline] 실행 실패:', formatErrorWithCause(error))
  process.exitCode = 1
})
