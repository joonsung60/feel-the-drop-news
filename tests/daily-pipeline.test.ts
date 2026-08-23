import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import path from 'node:path'
import {
  aggregateJob,
  assertResumeCandidate,
  classifyRun,
  hasQueuedJobs,
  parseDailyPipelineMode,
  parsePublishNumbers,
  validatePublishSelection,
} from '../lib/daily-pipeline'
import { prepareDailyNotification } from '../lib/daily-notification'
import { validateTelegramResponse } from '../lib/telegram'
import {
  ARTICLE_PREVIEW_LENGTH,
  buildArticleCardMessage,
  buildArticleCardReplyMarkup,
  formatArticleMessage,
} from '../lib/telegram-article-card'
import { shouldNotifyWorkerForJob } from '../lib/daily-notification'
import { isValidDailyDeleteRequest, validateDailyDeleteState } from '../lib/daily-delete'

test('게시 번호는 쉼표로 구분된 양의 정수만 허용한다', () => {
  assert.deepEqual(parsePublishNumbers('1,3,5'), [1, 3, 5])
  for (const invalid of ['1, 3', '1-3', '0,1', '1,', '1,1', '']) {
    assert.equal(parsePublishNumbers(invalid), null)
  }
})

test('하나라도 활성 실행 범위를 벗어나면 전체 선택을 거부한다', () => {
  const result = validatePublishSelection('1,4', new Set([1, 2, 3]))
  assert.equal(result.ok, false)
})

test('부분 실패와 전체 완료를 구분한다', () => {
  assert.equal(classifyRun(3, 2, 1), 'partial')
  assert.equal(classifyRun(3, 3, 0), 'succeeded')
  assert.equal(classifyRun(3, 0, 3), 'failed')
  assert.equal(classifyRun(0, 0, 0), 'succeeded')
})

test('완료 집계는 article ID가 없는 done 결과를 실패로 취급한다', () => {
  assert.equal(aggregateJob({
    id: 'job-1', status: 'done', result: {}, error_message: null,
  }).status, 'failed')
  assert.deepEqual(aggregateJob({
    id: 'job-2',
    status: 'done',
    result: { article: { id: 'article-1', title: '초안' } },
    error_message: null,
  }), {
    jobId: 'job-2', status: 'done', articleId: 'article-1', articleTitle: '초안', error: null,
  })
})

test('DB unique run_date를 중복 실행 방지의 최종 경계로 사용한다', () => {
  const runDates = new Set<string>()
  const acquire = (date: string) => runDates.has(date) ? false : (runDates.add(date), true)
  assert.equal(acquire('2026-08-18'), true)
  assert.equal(acquire('2026-08-18'), false)
})

test('선택 결과가 없거나 enqueue가 전부 실패하면 job polling을 건너뛴다', () => {
  assert.equal(hasQueuedJobs([]), false)
  assert.equal(hasQueuedJobs([{ job_id: null }, { job_id: null }]), false)
  assert.equal(hasQueuedJobs([{ job_id: null }, { job_id: 'job-1' }]), true)
})

test('migration은 일일 이력을 보존하면서 pending suggestion 삭제를 허용한다', () => {
  const migration = readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20260818000000_daily_pipeline.sql'),
    'utf8',
  )
  assert.match(migration, /suggestion_id uuid references public\.suggested_clusters\(id\) on delete set null/)
  assert.match(migration, /function public\.clear_pending_suggested_clusters\(\)/)
  assert.match(migration, /where id::text in \(/)
})

test('운영 runner는 clear_topics 다음에 RSS collect를 실행한다', () => {
  const runner = readFileSync(
    path.resolve(process.cwd(), 'scripts/daily-pipeline.ts'),
    'utf8',
  )
  const clearIndex = runner.indexOf("apiJson('/api/suggest-clusters?status=pending'")
  const collectIndex = runner.indexOf("apiJson('/api/collect'")
  assert.ok(clearIndex >= 0)
  assert.ok(collectIndex > clearIndex)
})

test('migration은 자동 job과 생성 기사 및 batch publish에 DB idempotency 경계를 둔다', () => {
  const migration = readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20260818000000_daily_pipeline.sql'),
    'utf8',
  )
  assert.match(migration, /job_queue_idempotency_key_idx/)
  assert.match(migration, /articles_generation_key_idx/)
  assert.match(migration, /function public\.ensure_suggestion_cluster/)
  assert.match(migration, /function public\.publish_article_batch/)
})

test('notify-only 결과는 성공 item만 display_order 순서로 준비한다', () => {
  const result = prepareDailyNotification({
    id: 'run-1', run_date: '2026-08-18', status: 'partial', selected_count: 3,
    success_count: 2, failure_count: 1, completed_at: '2026-08-18T15:00:00Z',
    collect_result: null, clear_result: null,
  }, [
    { status: 'done', article_id: 'a2', article_title: '둘', selection_order: 1, display_order: 2 },
    { status: 'failed', article_id: null, article_title: null, selection_order: 2, display_order: null },
    { status: 'done', article_id: 'a1', article_title: '하나', selection_order: 3, display_order: 1 },
  ])
  assert.deepEqual(result.succeeded.map((item) => item.article_id), ['a1', 'a2'])
})

test('notify-only는 불완전하거나 진행 중인 실행을 전송 전에 거부한다', () => {
  const run = {
    id: 'run-1', run_date: '2026-08-18', status: 'succeeded', selected_count: 1,
    success_count: 1, failure_count: 0, completed_at: '2026-08-18T15:00:00Z',
    collect_result: null, clear_result: null,
  }
  assert.throws(() => prepareDailyNotification(run, []), /불완전/)
  assert.throws(() => prepareDailyNotification(
    { ...run, status: 'waiting' },
    [{ status: 'done', article_id: 'a1', article_title: '하나', selection_order: 1, display_order: 1 }],
  ), /succeeded\/partial/)
})

test('notify-only 진입은 일반 pipeline main을 호출하지 않고 종료한다', () => {
  const runner = readFileSync(path.resolve(process.cwd(), 'scripts/daily-pipeline.ts'), 'utf8')
  assert.match(
    runner,
    /if \(mode\.kind === 'notify-only'\)[\s\S]*await notifyRun\(mode\.runId, 'notify-only'\)[\s\S]*return[\s\S]*await main\(mode\.retryFailed\)/,
  )
})

test('resume-run은 저장된 날짜를 사용하고 현재 날짜의 신규 run을 만들지 않는다', () => {
  const runner = readFileSync(path.resolve(process.cwd(), 'scripts/daily-pipeline.ts'), 'utf8')
  const resumeStart = runner.indexOf('async function resumeRun')
  const resumeEnd = runner.indexOf('async function entrypoint', resumeStart)
  const resumeSource = runner.slice(resumeStart, resumeEnd)
  assert.match(resumeSource, /acquireRun\(candidate\.run_date as string, lockToken, false\)/)
  assert.doesNotMatch(resumeSource, /koreanDate\(/)
  assert.doesNotMatch(resumeSource, /apiJson\(/)
  assert.doesNotMatch(resumeSource, /enqueue\(/)
})

test('resume-run 옵션은 UUID를 엄격히 검증하고 다른 모드와 상호 배타적이다', () => {
  const runId = 'e39aedc8-e536-4aa3-ace7-004912bf5120'
  assert.deepEqual(parseDailyPipelineMode(['--resume-run', runId]), { kind: 'resume-run', runId })
  assert.deepEqual(parseDailyPipelineMode(['--notify-only', runId]), { kind: 'notify-only', runId })
  assert.deepEqual(parseDailyPipelineMode(['--retry-failed']), { kind: 'normal', retryFailed: true })
  for (const args of [
    ['--resume-run', 'not-a-uuid'],
    ['--resume-run', runId, '--retry-failed'],
    ['--notify-only', runId, '--resume-run', runId],
    ['--retry-failed', '--resume-run', runId],
  ]) assert.throws(() => parseDailyPipelineMode(args), /사용법/)
})

test('resume-run은 유효 lease와 completed run을 거부한다', () => {
  const runId = 'e39aedc8-e536-4aa3-ace7-004912bf5120'
  const candidate = {
    id: runId,
    run_date: '2026-08-19',
    status: 'waiting',
    completed_at: null,
    runner_lock_token: 'lock',
    runner_lease_expires_at: '2026-08-20T00:39:22+09:00',
    clear_result: {}, collect_result: {}, suggest_result: {}, selected_count: 15,
  }
  assert.throws(
    () => assertResumeCandidate(candidate, runId, new Date('2026-08-20T00:00:00+09:00')),
    /lease가 아직 유효/,
  )
  assert.throws(
    () => assertResumeCandidate({ ...candidate, status: 'succeeded', completed_at: '2026-08-19T23:00:00+09:00' }, runId),
    /완료된 daily run/,
  )
})

test('resume-run은 acquire 결과 ID 불일치와 불완전 persisted state를 거부한다', () => {
  const runId = 'e39aedc8-e536-4aa3-ace7-004912bf5120'
  const candidate = {
    id: runId,
    run_date: '2026-08-19',
    status: 'waiting',
    completed_at: null,
    runner_lock_token: 'expired-lock',
    runner_lease_expires_at: '2026-08-19T23:00:00+09:00',
    clear_result: {}, collect_result: {}, suggest_result: {}, selected_count: 15,
  }
  assert.throws(
    () => assertResumeCandidate(candidate, '7d4addcd-ee9b-4df0-84ee-ba57037ed188', new Date('2026-08-20T01:00:00+09:00')),
    /run ID 불일치/,
  )
  assert.throws(
    () => assertResumeCandidate({ ...candidate, suggest_result: null }, runId, new Date('2026-08-20T01:00:00+09:00')),
    /기존 단계 결과가 없습니다/,
  )
})

test('resume-run은 존재하지 않는 run과 기존 item 불일치를 명확히 실패시킨다', () => {
  const runner = readFileSync(path.resolve(process.cwd(), 'scripts/daily-pipeline.ts'), 'utf8')
  assert.match(runner, /resume할 daily run을 찾을 수 없습니다/)
  assert.match(runner, /기존 daily item 수가 selected_count와 다릅니다/)
  assert.match(runner, /job ID가 없는 기존 daily item/)
  assert.match(runner, /await waitForJobs\(run, items, lockToken\)/)
  assert.match(runner, /await finish\(run, lockToken\)/)
})

test('resume-run 동시 실행 경계는 OS 프로세스 탐색이 아니라 DB acquire만 사용한다', () => {
  const source = readFileSync(path.join(process.cwd(), 'scripts/daily-pipeline.ts'), 'utf8')
  assert.doesNotMatch(source, /\/proc|pgrep|processIds|다른 daily runner 프로세스/)
  assert.match(source, /acquireRun\(candidate\.run_date as string, lockToken, false\)/)
  assert.match(source, /if \(acquiredRun\.id !== requestedRunId\)/)
})

test('resume systemd template은 명시적 run만 집계하며 자동 설치 대상이 아니다', () => {
  const unit = readFileSync(
    path.resolve(process.cwd(), 'ops/systemd/feel-the-drop-daily-resume@.service'),
    'utf8',
  )
  assert.match(unit, /--resume-run %i/)
  assert.match(unit, /TimeoutStartSec=5h/)
  assert.doesNotMatch(unit, /\[Install\]/)
  assert.doesNotMatch(unit, /WantedBy=/)
})

test('Telegram은 HTTP 200이어도 JSON ok가 true가 아니면 실패한다', () => {
  assert.doesNotThrow(() => validateTelegramResponse(200, '{"ok":true,"result":{}}'))
  assert.throws(
    () => validateTelegramResponse(200, '{"ok":false,"description":"chat not found"}'),
    /chat not found/,
  )
  assert.throws(() => validateTelegramResponse(502, '{"ok":true}'), /HTTP 502/)
})

test('짧은 기사 카드는 한 메시지에 번호, 제목, 본문을 모두 담는다', () => {
  const card = buildArticleCardMessage(
    { displayOrder: 3, title: '제목', content: '짧은 본문' }, 'publish', 'delete',
  )
  assert.equal(card.text, '3. 제목\n\n짧은 본문')
})

test('긴 기사 카드는 기존 500자 preview 뒤에 말줄임표를 붙인 한 메시지다', () => {
  const content = '가'.repeat(ARTICLE_PREVIEW_LENGTH + 100)
  const card = buildArticleCardMessage(
    { displayOrder: 1, title: '긴 기사', content }, 'publish', 'delete',
  )
  assert.equal(card.text, `1. 긴 기사\n\n${'가'.repeat(ARTICLE_PREVIEW_LENGTH)}...`)
})

test('기사 카드 버튼에는 게시와 삭제가 함께 구성된다', () => {
  assert.deepEqual(buildArticleCardReplyMarkup('daily_publish:run:1', 'daily_delete:run:1'), {
    inline_keyboard: [[
      { text: '게시', callback_data: 'daily_publish:run:1' },
      { text: '삭제', callback_data: 'daily_delete:run:1' },
    ]],
  })
})

test('/articles 수동 카드는 기존 번호 없는 제목과 500자 preview 출력을 유지한다', () => {
  assert.equal(formatArticleMessage({ title: '수동 기사', content: '본문' }), '수동 기사\n\n본문')
  assert.equal(
    formatArticleMessage({ title: '수동 기사', content: 'x'.repeat(501) }),
    `수동 기사\n\n${'x'.repeat(500)}...`,
  )
})

test('worker는 daily job 중간 알림을 억제하고 수동 job 알림은 유지한다', () => {
  assert.equal(shouldNotifyWorkerForJob({ dailyPipelineRunId: 'run-1' }), false)
  assert.equal(shouldNotifyWorkerForJob({ suggestionId: 'suggestion-1' }), true)
  assert.equal(shouldNotifyWorkerForJob(null), true)
})

test('daily 삭제는 잘못된 run/번호와 게시된 기사를 거부한다', () => {
  assert.equal(isValidDailyDeleteRequest('bad-run', 1), false)
  assert.equal(isValidDailyDeleteRequest('7d4addcd-ee9b-4df0-84ee-ba57037ed188', 0), false)
  assert.match(validateDailyDeleteState({
    runStatus: 'succeeded', itemStatus: 'done', articleId: 'article-1', articlePublished: true,
  }) ?? '', /게시된/)
  assert.match(validateDailyDeleteState({
    runStatus: 'succeeded', itemStatus: 'deleted', articleId: null, articlePublished: null,
  }) ?? '', /삭제 가능한/)
})

test('삭제된 daily 번호는 batch publish 조회에서 제외된다', () => {
  const route = readFileSync(path.resolve(process.cwd(), 'app/api/articles/publish-batch/route.ts'), 'utf8')
  assert.match(route, /eq\('status', 'done'\)/)
  assert.match(route, /not\('article_id', 'is', null\)/)
})

test('daily 삭제 migration은 item 이력을 보존하고 deleted 상태를 허용한다', () => {
  const migration = readFileSync(
    path.resolve(process.cwd(), 'supabase/migrations/20260818154745_preserve_daily_item_on_article_delete.sql'),
    'utf8',
  )
  assert.match(migration, /on delete set null/)
  assert.match(migration, /'deleted'/)
})
