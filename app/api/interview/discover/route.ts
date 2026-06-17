import { NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

type InterviewCandidate = {
  id: string
  title: string | null
  url: string
  published_at: string | null
  suggestion_state: string | null
}

const INTERVIEW_MATCH_FILTER = [
  'url.ilike.%/interview/%',
  'url.ilike.%/interviews/%',
  'url.ilike.%/feature/%',
  'url.ilike.%/features/%',
  'url.ilike.%/talks/%',
  'url.ilike.%/conversation/%',
  'title.ilike.%interview%',
  'title.ilike.%in conversation%',
  'title.ilike.%conversation with%',
  'title.ilike.%talks to%',
  'title.ilike.%speaks to%',
  'title.ilike.%chats to%',
  'title.ilike.%catches up%',
  'title.ilike.%Q&A%',
  'content.ilike.%interview%',
  'content.ilike.%in conversation%',
  'content.ilike.%talks to%',
  'content.ilike.%speaks to%',
  'content.ilike.%catches up%',
].join(',')

export async function POST() {
  const { data, error } = await supabase
    .from('raw_articles')
    .select('id, title, url, published_at, suggestion_state')
    .or('suggestion_state.is.null,suggestion_state.eq.new,suggestion_state.eq.suggested')
    .or(INTERVIEW_MATCH_FILTER)
    .order('published_at', { ascending: false, nullsFirst: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  const candidates = (data ?? []) as InterviewCandidate[]

  return NextResponse.json({
    success: true,
    candidates,
    discovered: candidates.length,
  })
}
