import type { DeployHookResult } from '@/lib/deploy-hook'

export type DailyDeployResult =
  | { status: 'not_claimed' }
  | { status: 'succeeded'; attempt: number }
  | { status: 'failed'; error: string; attempt: number }

export type ClaimedDeploy = { run_id: string; claim_token: string; deploy_status: string }

export async function orchestrateDailyDeploy(input: {
  claim: () => Promise<ClaimedDeploy | null>
  sendDeploy: () => Promise<DeployHookResult>
  record: (claim: ClaimedDeploy, success: boolean, error: string | null) => Promise<boolean>
  notifyFailure: (message: string) => Promise<void>
  attempt: number
}): Promise<DailyDeployResult> {
  const claim = await input.claim()
  if (!claim) return { status: 'not_claimed' }
  let result: DeployHookResult
  try {
    result = await input.sendDeploy()
  } catch (error) {
    result = { success: false, error: error instanceof Error ? error.message : String(error) }
  }
  const error = result.success ? null : result.error ?? (result.cooldown ? 'deploy hook cooldown' : 'unknown deploy error')
  const recorded = await input.record(claim, result.success, error)
  if (!recorded) throw new Error(`daily deploy 결과 저장 권한을 잃었습니다: ${claim.run_id}`)
  if (result.success) return { status: 'succeeded', attempt: input.attempt }
  await input.notifyFailure(
    `❌ Daily Cloudflare 배포 실패\nrun: ${claim.run_id}\n오류: ${error}\n재시도: /daily_deploy_retry ${claim.run_id}`,
  )
  return { status: 'failed', error: error!, attempt: input.attempt }
}
