import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export async function triggerDeployHook(): Promise<{ success: boolean; cooldown?: boolean }> {
  const deployHookUrl = process.env.CLOUDFLARE_DEPLOY_HOOK_URL
  if (!deployHookUrl) return { success: false }

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

    if (data?.updated_at) {
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

      const res = await fetch(deployHookUrl, { method: 'POST' })
      if (!res.ok) {
        console.error('[deploy-hook] returned', res.status, res.statusText)
        return { success: false }
      } else {
        console.log('[deploy-hook] triggered successfully.')
        return { success: true }
      }
    }
    
    return { success: false }
  } catch (err) {
    console.error('[deploy-hook] error:', err)
    return { success: false }
  }
}
