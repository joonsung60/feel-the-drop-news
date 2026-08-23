import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { orchestrateDailyDeploy, type ClaimedDeploy } from '../lib/daily-deploy-orchestrator'

const claim: ClaimedDeploy = { run_id: 'run-1', claim_token: 'token-1', deploy_status: 'claimed' }

test('마지막 미처리 item 전에는 deploy hook을 호출하지 않는다', async () => {
  let deploys = 0
  const result = await orchestrateDailyDeploy({
    claim: async () => null,
    sendDeploy: async () => { deploys++; return { success: true } },
    record: async () => true,
    notifyFailure: async () => undefined,
    attempt: 1,
  })
  assert.deepEqual(result, { status: 'not_claimed' })
  assert.equal(deploys, 0)
})

test('동시 finalizer와 callback 재전송에서도 atomic claim 승자만 한 번 deploy한다', async () => {
  let claimed = false
  let deploys = 0
  const run = () => orchestrateDailyDeploy({
    claim: async () => {
      if (claimed) return null
      claimed = true
      return claim
    },
    sendDeploy: async () => { deploys++; return { success: true } },
    record: async () => true,
    notifyFailure: async () => undefined,
    attempt: 1,
  })
  const results = await Promise.all([run(), run(), run()])
  assert.equal(results.filter((result) => result.status === 'succeeded').length, 1)
  assert.equal(deploys, 1)
})

test('deploy 실패를 기록하고 Telegram 재시도 안내를 만든다', async () => {
  const records: Array<{ success: boolean; error: string | null }> = []
  const messages: string[] = []
  const result = await orchestrateDailyDeploy({
    claim: async () => claim,
    sendDeploy: async () => ({ success: false, error: 'HTTP 503' }),
    record: async (_claim, success, error) => { records.push({ success, error }); return true },
    notifyFailure: async (message) => { messages.push(message) },
    attempt: 2,
  })
  assert.deepEqual(result, { status: 'failed', error: 'HTTP 503', attempt: 2 })
  assert.deepEqual(records, [{ success: false, error: 'HTTP 503' }])
  assert.match(messages[0], /daily_deploy_retry run-1/)
})

test('migration은 item 처리 완료 후에만 deploy를 atomic claim하고 service_role만 실행한다', () => {
  const migration = readFileSync(path.resolve(process.cwd(), 'supabase/migrations/20260820114500_daily_final_deploy_telemetry.sql'), 'utf8')
  assert.match(migration, /status not in \('published', 'deleted', 'failed'\)/)
  assert.match(migration, /deploy_status = 'claimed'/)
  assert.match(migration, /deploy_claim_token = requested_claim_token/)
  assert.match(migration, /publish_daily_article_batch/)
  assert.match(migration, /status = 'published'/)
  assert.match(migration, /revoke execute[\s\S]*from public, anon, authenticated/)
  assert.match(migration, /grant execute[\s\S]*to service_role/)
})

test('daily API만 최종 deploy를 사용하고 수동 publish route는 기존 deploy 동작을 유지한다', () => {
  const dailyPublish = readFileSync(path.resolve(process.cwd(), 'app/api/articles/publish-batch/route.ts'), 'utf8')
  const dailyDelete = readFileSync(path.resolve(process.cwd(), 'app/api/daily-pipeline/[runId]/items/[displayOrder]/route.ts'), 'utf8')
  const manualPublish = readFileSync(path.resolve(process.cwd(), 'app/api/articles/[id]/publish/route.ts'), 'utf8')
  assert.match(dailyPublish, /finalizeDailyDeploy\(runId\)/)
  assert.doesNotMatch(dailyPublish, /triggerDeployHook/)
  assert.match(dailyDelete, /finalizeDailyDeploy\(runId\)/)
  assert.match(manualPublish, /executePreparedPublish\(prepared, true\)/)
})

test('runner는 시작과 실패 단계 telemetry를 포함한다', () => {
  const runner = readFileSync(path.resolve(process.cwd(), 'scripts/daily-pipeline.ts'), 'utf8')
  assert.match(runner, /🚀 일일 파이프라인 시작/)
  for (const stage of ['clear', 'collect', 'suggest', 'generation', 'notification']) {
    assert.match(runner, new RegExp(`failureStage = '${stage}'`))
  }
  assert.match(runner, /단계: \$\{failureStage\}/)
})
