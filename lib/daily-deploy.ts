import { randomUUID } from 'node:crypto'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { triggerDeployHook } from '@/lib/deploy-hook'
import { notifyConfiguredTelegramUsers } from '@/lib/telegram'
import { orchestrateDailyDeploy, type ClaimedDeploy, type DailyDeployResult } from '@/lib/daily-deploy-orchestrator'

export async function finalizeDailyDeploy(runId: string, allowFailedRetry = false): Promise<DailyDeployResult> {
  const claimToken = randomUUID()
  const { data: run, error: runError } = await supabase.from('daily_pipeline_runs')
    .select('deploy_attempt_count').eq('id', runId).maybeSingle()
  if (runError) throw runError
  if (!run) throw new Error(`daily run을 찾을 수 없습니다: ${runId}`)
  return orchestrateDailyDeploy({
    attempt: Number(run.deploy_attempt_count ?? 0) + 1,
    claim: async () => {
      const { data, error } = await supabase.rpc('claim_daily_pipeline_deploy', {
        requested_run_id: runId,
        requested_claim_token: claimToken,
        allow_failed_retry: allowFailedRetry,
      })
      if (error) throw error
      return ((data ?? [])[0] as ClaimedDeploy | undefined) ?? null
    },
    sendDeploy: () => triggerDeployHook({ force: true }),
    record: async (claim, success, errorMessage) => {
      const { data, error } = await supabase.rpc('record_daily_pipeline_deploy', {
        requested_run_id: claim.run_id,
        requested_claim_token: claim.claim_token,
        requested_success: success,
        requested_error: errorMessage,
      })
      if (error) throw error
      return data === true
    },
    notifyFailure: notifyConfiguredTelegramUsers,
  })
}
