import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export async function GET() {
  const { data, error } = await supabase
    .from('text_sources')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ textSources: data })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { raw_text, source_memo, source_url, source_date, mode } = body

  if (!raw_text || !source_memo) {
    return NextResponse.json({ error: 'raw_text와 source_memo는 필수입니다.' }, { status: 400 })
  }

  const normalizedMode = mode === 'translate' ? 'translate' : 'article'

  const { data, error } = await supabase
    .from('text_sources')
    .insert({
      raw_text,
      source_memo,
      source_url: source_url || null,
      source_date: source_date || null,
      status: 'pending',
      mode: normalizedMode,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ textSource: data })
}
