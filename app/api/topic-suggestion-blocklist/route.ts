import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

type BlockRuleUpdate = {
  enabled?: boolean
  reason?: string | null
}

function normalizePattern(pattern: unknown): string {
  return typeof pattern === 'string' ? pattern.trim() : ''
}

export async function GET() {
  const { data, error } = await supabase
    .from('topic_suggestion_blocklist')
    .select('id, pattern, reason, enabled, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ rules: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const pattern = normalizePattern(body.pattern)
    const reason = typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim()
      : null

    if (!pattern) {
      return NextResponse.json({ error: '차단할 키워드가 필요합니다.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('topic_suggestion_blocklist')
      .insert({
        pattern,
        reason,
        enabled: true,
      })
      .select('id, pattern, reason, enabled, created_at')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ rule: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const id = typeof body.id === 'string' ? body.id.trim() : ''
    if (!id) {
      return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    }

    const updates: BlockRuleUpdate = {}
    if (typeof body.enabled === 'boolean') {
      updates.enabled = body.enabled
    }
    if (body.reason === null || typeof body.reason === 'string') {
      updates.reason = typeof body.reason === 'string' && body.reason.trim()
        ? body.reason.trim()
        : null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: '업데이트할 필드가 없습니다.' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('topic_suggestion_blocklist')
      .update(updates)
      .eq('id', id)
      .select('id, pattern, reason, enabled, created_at')
      .maybeSingle()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) {
      return NextResponse.json({ error: '차단 규칙을 찾을 수 없습니다.' }, { status: 404 })
    }

    return NextResponse.json({ rule: data })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')?.trim()
  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('topic_suggestion_blocklist')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
