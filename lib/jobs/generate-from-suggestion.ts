import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { generateFromCluster } from './generate-from-cluster'

type SuggestedClusterRow = {
  id: string
  topic: string | null
  keywords: string[] | null
  article_ids: string[] | null
  status: string | null
}

export type SuggestionGenerationResult = {
  suggestionId: string
  clusterId: string
  article: Record<string, unknown>
}

async function rollbackSuggestionToPending(suggestionId: string): Promise<void> {
  const { error } = await supabase
    .from('suggested_clusters')
    .update({ status: 'pending' })
    .eq('id', suggestionId)
  if (error) {
    console.error('[generate-from-suggestion] pending 롤백 실패:', error.message)
  }
}

export async function generateFromSuggestion(
  suggestionId: string
): Promise<SuggestionGenerationResult> {
  if (!suggestionId) {
    throw new Error('suggestionId가 필요합니다.')
  }

  const { data: suggestion, error: suggestionError } = await supabase
    .from('suggested_clusters')
    .update({ status: 'approved' })
    .eq('id', suggestionId)
    .select()
    .maybeSingle()

  if (suggestionError) {
    throw new Error(`제안 승인 실패: ${suggestionError.message}`)
  }
  if (!suggestion) {
    throw new Error('제안을 찾을 수 없습니다.')
  }

  const row = suggestion as SuggestedClusterRow
  const topic = typeof row.topic === 'string' ? row.topic.trim() : ''
  const keywords = Array.isArray(row.keywords)
    ? row.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
    : []
  const articleIds = Array.isArray(row.article_ids)
    ? Array.from(new Set(
        row.article_ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      ))
    : []

  if (!topic) {
    await rollbackSuggestionToPending(suggestionId)
    throw new Error('제안 데이터에 topic이 없습니다.')
  }
  if (articleIds.length === 0 && keywords.length === 0) {
    await rollbackSuggestionToPending(suggestionId)
    throw new Error('제안 데이터에 articleIds와 keywords가 모두 없습니다.')
  }

  let clusterId: string
  try {
    let matchedArticleIds: string[]
    if (articleIds.length > 0) {
      const { data: matched, error: matchedError } = await supabase
        .from('raw_articles')
        .select('id')
        .in('id', articleIds)
      if (matchedError) throw matchedError
      matchedArticleIds = (matched ?? []).map((m: { id: string }) => m.id)
    } else {
      const sanitized = keywords
        .map((k) => k.replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim())
        .filter((k) => k.length > 0)
      if (sanitized.length === 0) {
        throw new Error('검색 가능한 키워드가 없습니다.')
      }
      const orCondition = sanitized
        .map((keyword) => `title.ilike.%${keyword}%,content.ilike.%${keyword}%`)
        .join(',')
      const { data: matched, error: matchedError } = await supabase
        .from('raw_articles')
        .select('id')
        .or(orCondition)
        .order('published_at', { ascending: false })
        .limit(20)
      if (matchedError) throw matchedError
      matchedArticleIds = (matched ?? []).map((m: { id: string }) => m.id)
    }

    if (matchedArticleIds.length === 0) {
      throw new Error('매칭된 기사가 없습니다.')
    }

    const { data: cluster, error: clusterError } = await supabase
      .from('article_clusters')
      .insert({ topic, keywords })
      .select()
      .single()
    if (clusterError) throw clusterError

    clusterId = cluster.id as string

    const clusterArticleLinks = matchedArticleIds.map((rawArticleId) => ({
      cluster_id: clusterId,
      raw_article_id: rawArticleId,
    }))
    const { error: linkError } = await supabase
      .from('cluster_articles')
      .insert(clusterArticleLinks)
    if (linkError) throw linkError
  } catch (err) {
    await rollbackSuggestionToPending(suggestionId)
    throw err instanceof Error ? err : new Error(String(err))
  }

  let article: Record<string, unknown>
  try {
    const results = await generateFromCluster([clusterId])
    const result = results[0]
    if (!result) {
      throw new Error('기사 생성 실패: 알 수 없는 오류')
    }
    if (result.success === false) {
      throw new Error(`기사 생성 실패: ${result.error}`)
    }
    article = result.article
  } catch (err) {
    await rollbackSuggestionToPending(suggestionId)
    throw err instanceof Error ? err : new Error(String(err))
  }

  const { error: publishError } = await supabase
    .from('suggested_clusters')
    .update({ status: 'published', cluster_id: clusterId })
    .eq('id', suggestionId)
  if (publishError) {
    await rollbackSuggestionToPending(suggestionId)
    throw new Error(`제안 published 처리 실패: ${publishError.message}`)
  }

  return { suggestionId, clusterId, article }
}
