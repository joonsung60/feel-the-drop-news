import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export type DeployHookResult = { success: boolean; cooldown?: boolean; error?: string }

export async function triggerDeployHook(options: { force?: boolean } = {}): Promise<DeployHookResult> {
  const deployHookUrl = process.env.CLOUDFLARE_DEPLOY_HOOK_URL
  if (!deployHookUrl) return { success: false, error: 'CLOUDFLARE_DEPLOY_HOOK_URL이 없습니다.' }

  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('updated_at')
      .eq('key', 'deploy_hook_last_sent')
      .maybeSingle()

    if (error) {
      console.error('[deploy-hook] failed to check last sent time:', error)
    }

    const now = new Date()
    let shouldSend = true

    if (!options.force && data?.updated_at) {
      const lastSent = new Date(data.updated_at)
      const diffMs = now.getTime() - lastSent.getTime()
      const diffMins = diffMs / (1000 * 60)
      
      if (diffMins < 3) {
        shouldSend = false
        console.log(`[deploy-hook] skipped. Last sent ${diffMins.toFixed(1)} mins ago.`)
        return { success: false, cooldown: true }
      }
    }

    if (shouldSend) {
      const { error: upsertError } = await supabase
        .from('system_settings')
        .upsert({ 
          key: 'deploy_hook_last_sent', 
          value: 'sent',
          updated_at: now.toISOString() 
        })

      if (upsertError) {
        console.error('[deploy-hook] failed to update last sent time:', upsertError)
      }

      const res = await fetch(deployHookUrl, { method: 'POST', signal: AbortSignal.timeout(15_000) })
      if (!res.ok) {
        console.error('[deploy-hook] returned', res.status, res.statusText)
        return { success: false, error: `Cloudflare deploy hook HTTP ${res.status}: ${res.statusText}` }
      } else {
        console.log('[deploy-hook] triggered successfully.')
        return { success: true }
      }
    }
    
    return { success: false }
  } catch (err) {
    console.error('[deploy-hook] error:', err)
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
