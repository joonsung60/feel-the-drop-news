import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export async function GET() {
  const { data: run, error: runError } = await supabase.from('daily_pipeline_runs')
    .select('id, run_date, status, success_count, failure_count')
    .in('status', ['succeeded', 'partial'])
    .order('run_date', { ascending: false }).order('created_at', { ascending: false })
    .limit(1).maybeSingle()
  if (runError) return NextResponse.json({ error: runError.message }, { status: 500 })
  if (!run) return NextResponse.json({ run: null, items: [] })
  const { data: items, error: itemError } = await supabase.from('daily_pipeline_items')
    .select('display_order, article_id, article_title, articles(title, content, published)')
    .eq('run_id', run.id).eq('status', 'done').not('display_order', 'is', null)
    .order('display_order', { ascending: true })
  if (itemError) return NextResponse.json({ error: itemError.message }, { status: 500 })
  return NextResponse.json({ run, items: items ?? [] })
}
