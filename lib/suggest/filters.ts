import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { SuggestionWithArticles, TopicBlockRule } from './types'
import { normalizeTopicKey } from './normalize'
import { fetchPublishedTopicRows } from './published-topic-query'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export function isMissingBlocklistTableError(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '42P01'
    || /topic_suggestion_blocklist/i.test(error.message ?? '')
    || /could not find the table/i.test(error.message ?? '')
  )
}

export async function loadActiveBlockRules(): Promise<TopicBlockRule[]> {
  const { data, error } = await supabase
    .from('topic_suggestion_blocklist')
    .select('id, pattern, reason')
    .eq('enabled', true)
    .order('created_at', { ascending: false })

  if (error) {
    if (isMissingBlocklistTableError(error)) {
      console.warn('[suggest-clusters] topic_suggestion_blocklist 테이블이 없어 차단 규칙을 건너뜁니다.')
      return []
    }
    throw new Error(`토픽 차단 규칙 조회 실패: ${error.message}`)
  }

  return ((data ?? []) as TopicBlockRule[])
    .map((rule) => ({
      ...rule,
      pattern: rule.pattern.trim(),
    }))
    .filter((rule) => rule.pattern.length > 0)
}

export function matchesBlockRule(suggestion: SuggestionWithArticles, rule: TopicBlockRule): boolean {
  const pattern = normalizeTopicKey(rule.pattern)
  if (!pattern) return false

  const searchable = [
    suggestion.topic,
    ...suggestion.keywords,
    ...(suggestion.commonEntities ?? []),
  ].join('\n').toLowerCase()

  return searchable.includes(pattern)
}

export async function loadExistingTopicKeys(): Promise<Set<string>> {
  const existingTopicKeys = new Set<string>()

  const { data: existingSuggestionRows, error: existingSuggestionError } = await supabase
    .from('suggested_clusters')
    .select('topic')
    .in('status', ['pending', 'rejected'])

  if (existingSuggestionError) {
    throw new Error(`기존 제안 토픽 조회 실패: ${existingSuggestionError.message}`)
  }

  for (const row of (existingSuggestionRows ?? []) as { topic: string | null }[]) {
    if (row.topic) existingTopicKeys.add(normalizeTopicKey(row.topic))
  }

  const { data: publishedRows, error: publishedError } = await supabase
    .from('articles')
    .select('cluster_id')
    .eq('published', true)
    .not('cluster_id', 'is', null)

  if (publishedError) {
    throw new Error(`게시 완료 기사 조회 실패: ${publishedError.message}`)
  }

  const publishedClusterIds = Array.from(new Set(
    ((publishedRows ?? []) as { cluster_id: string | null }[])
      .map((row) => row.cluster_id)
      .filter((id): id is string => Boolean(id))
  ))

  if (publishedClusterIds.length > 0) {
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('게시 완료 토픽 조회 실패: Supabase 서버 환경변수가 없습니다.')
    }
    const clusterRows = await fetchPublishedTopicRows(
      publishedClusterIds,
      supabaseUrl,
      supabaseServiceRoleKey,
    ).catch((error) => {
      throw new Error(`게시 완료 토픽 조회 실패: ${error instanceof Error ? error.message : String(error)}`)
    })

    for (const row of clusterRows) {
      if (row.topic) existingTopicKeys.add(normalizeTopicKey(row.topic))
    }
  }

  return existingTopicKeys
}

export async function filterDuplicateSuggestions(
  suggestions: SuggestionWithArticles[],
  onDropped?: (suggestion: SuggestionWithArticles, reason: 'duplicate_topic' | 'blocklist') => void,
): Promise<{ suggestions: SuggestionWithArticles[]; duplicateSkipCount: number }> {
  const existingTopicKeys = await loadExistingTopicKeys()
  const blockRules = await loadActiveBlockRules()
  const filtered: SuggestionWithArticles[] = []
  let duplicateSkipCount = 0

  for (const suggestion of suggestions) {
    const topicKey = normalizeTopicKey(suggestion.topic)
    if (existingTopicKeys.has(topicKey)) {
      console.log(`skipped (duplicate): ${suggestion.topic}`)
      onDropped?.(suggestion, 'duplicate_topic')
      duplicateSkipCount++
      continue
    }

    if (blockRules.some((rule) => matchesBlockRule(suggestion, rule))) {
      console.log(`skipped (blocked): ${suggestion.topic}`)
      onDropped?.(suggestion, 'blocklist')
      continue
    }

    existingTopicKeys.add(topicKey)
    filtered.push(suggestion)
  }

  return { suggestions: filtered, duplicateSkipCount }
}
