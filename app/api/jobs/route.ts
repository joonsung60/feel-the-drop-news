import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

const ALLOWED_JOB_TYPES = new Set([
  'generate_from_cluster',
  'generate_from_image_source',
  'generate_from_text_source',
  'generate_from_suggestion',
  'interview_translate',
])

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    job_type?: unknown
    payload?: unknown
    idempotency_key?: unknown
  }

  const jobType = typeof body.job_type === 'string' ? body.job_type : ''
  if (!ALLOWED_JOB_TYPES.has(jobType)) {
    return NextResponse.json(
      { error: `유효하지 않은 job_type: ${jobType}` },
      { status: 400 }
    )
  }

  const payload =
    body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? body.payload
      : {}
  const idempotencyKey = typeof body.idempotency_key === 'string'
    ? body.idempotency_key.trim()
    : ''
  if (idempotencyKey.length > 200) {
    return NextResponse.json({ error: 'idempotency_key는 200자 이하여야 합니다.' }, { status: 400 })
  }

  const suggestionId = jobType === 'generate_from_suggestion'
    ? (payload as { suggestionId?: unknown }).suggestionId
    : null
  if (jobType === 'generate_from_suggestion'
    && (typeof suggestionId !== 'string' || suggestionId.length === 0)) {
    return NextResponse.json({ error: 'suggestionId가 필요합니다.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('job_queue')
    .insert({
      job_type: jobType,
      payload,
      status: 'pending',
      idempotency_key: idempotencyKey || null,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505' && idempotencyKey) {
      const { data: existing, error: existingError } = await supabase
        .from('job_queue')
        .select('id, status')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle()
      if (!existingError && existing) {
        return NextResponse.json({
          jobId: existing.id,
          status: existing.status,
          idempotent: true,
        })
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ jobId: data.id, status: 'pending' })
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('job_queue')
    .select('id, job_type, status, result, error_message, created_at, updated_at')
    .eq('id', id)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: '잡을 찾을 수 없습니다.' }, { status: 404 })
  }

  return NextResponse.json({
    jobId: data.id,
    job_type: data.job_type,
    status: data.status,
    result: data.result,
    error_message: data.error_message,
    created_at: data.created_at,
    updated_at: data.updated_at,
  })
}
