import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

const ALLOWED_STATUSES = new Set(['analyzed', 'draft_created', 'rejected'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const status = typeof body.status === 'string' ? body.status : ''

  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  }

  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: '유효하지 않은 status입니다.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('image_sources')
    .update({ status })
    .eq('id', id)
    .select()
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: '이미지 소스를 찾을 수 없습니다.' }, { status: 404 })
  }

  return NextResponse.json({ imageSource: data })
}
