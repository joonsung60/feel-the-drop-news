import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { suggestion_state } = await req.json()

  if (!id) {
    return NextResponse.json({ success: false, error: 'id가 필요합니다.' }, { status: 400 })
  }

  try {
    const { data, error } = await supabase
      .from('raw_articles')
      .update({ suggestion_state })
      .eq('id', id)
      .select()
      .single()

    if (error) throw error

    return NextResponse.json({ success: true, article: data })
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
