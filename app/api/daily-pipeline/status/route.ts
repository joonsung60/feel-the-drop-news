import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export async function GET() {
  const { data: run, error: runError } = await supabase.from('daily_pipeline_runs')
    .select('id, run_date, status, selected_count, success_count, failure_count, deploy_status, deploy_attempt_count, deploy_error, started_at, completed_at')
    .order('run_date', { ascending: false }).order('created_at', { ascending: false })
    .limit(1).maybeSingle()
  if (runError) return NextResponse.json({ error: runError.message }, { status: 500 })
  if (!run) return NextResponse.json({ run: null, progress: {} })
  const { data: items, error: itemError } = await supabase.from('daily_pipeline_items')
    .select('status').eq('run_id', run.id)
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 })
  const progress = (items ?? []).reduce<Record<string, number>>((counts, item) => {
    counts[item.status] = (counts[item.status] ?? 0) + 1
    return counts
  }, {})
  return NextResponse.json({ run, progress })
}
