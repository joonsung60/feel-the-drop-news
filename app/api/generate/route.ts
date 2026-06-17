import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { clusterIds?: unknown }

  if (!Array.isArray(body.clusterIds) || body.clusterIds.length === 0) {
    return NextResponse.json(
      { success: false, error: 'clusterIds가 필요합니다.' },
      { status: 400 }
    )
  }

  const { data, error } = await supabase
    .from('job_queue')
    .insert({
      job_type: 'generate_from_cluster',
      payload: { clusterIds: body.clusterIds },
      status: 'pending',
    })
    .select('id')
    .single()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ jobId: data.id, status: 'pending' })
}
