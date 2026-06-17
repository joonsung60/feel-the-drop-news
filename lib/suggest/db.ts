import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { DbSuggestedCluster, PersistedSuggestion, RawArticle, SuggestionWithArticles } from './types'
import { calculateCohesionScore, isCategoryKeyword } from './normalize'

export async function attachSourceMeta(articles: RawArticle[]): Promise<RawArticle[]> {
  const sourceIds = Array.from(new Set(
    articles
      .map((article) => article.source_id)
      .filter((id): id is string | number => id !== null)
  ))

  if (sourceIds.length === 0) {
    return articles
  }

  const sourceMeta = new Map<string, { name: string }>()
  const { data } = await supabase
    .from('rss_sources')
    .select('id, name')
    .in('id', sourceIds)

  for (const source of (data ?? []) as { id: string | number; name: string | null }[]) {
    const name = source.name ?? '알 수 없는 소스'
    sourceMeta.set(String(source.id), {
      name,
    })
  }

  return articles.map((article) => {
    const meta = article.source_id !== null ? sourceMeta.get(String(article.source_id)) : undefined
    return {
      ...article,
      sourceName: meta?.name,
    }
  })
}

export async function hydrateSuggestions(rows: DbSuggestedCluster[]): Promise<PersistedSuggestion[]> {
  if (rows.length === 0) return []

  const allIds = Array.from(new Set(rows.flatMap((row) => row.article_ids ?? [])))
  const articleMeta = new Map<string, { id: string; title: string; url: string }>()

  if (allIds.length > 0) {
    const { data: rawArticles } = await supabase
      .from('raw_articles')
      .select('id, title, url')
      .in('id', allIds)

    for (const article of (rawArticles ?? []) as { id: string; title: string; url: string }[]) {
      articleMeta.set(article.id, { id: article.id, title: article.title, url: article.url })
    }
  }

  return rows.map((row) => {
    const articleIds = row.article_ids ?? []
    const commonEntities = row.keywords?.filter((keyword) => !isCategoryKeyword(keyword)) ?? []
    return {
      id: row.id,
      topic: row.topic,
      keywords: row.keywords ?? [],
      articleIds,
      reason: commonEntities[0]
        ? `"${commonEntities[0]}"를 기준으로 저장된 제안입니다.`
        : undefined,
      commonEntities: commonEntities.length > 0 ? commonEntities : undefined,
      cohesionScore: commonEntities.length > 0
        ? calculateCohesionScore(articleIds, commonEntities, articleIds.map((id) => {
          const meta = articleMeta.get(id)
	          return {
	            id,
	            title: meta?.title ?? '',
	            content: null,
	            url: meta?.url ?? '',
	            source_id: null,
	          }
	        }))
        : undefined,
      articles: articleIds
        .map((id) => articleMeta.get(id))
        .filter((a): a is { id: string; title: string; url: string } => Boolean(a)),
      status: row.status,
      clusterId: row.cluster_id,
      articleId: null,
      createdAt: row.created_at,
    }
  })
}

export async function markRawArticlesSuggested(suggestions: SuggestionWithArticles[]): Promise<void> {
  const articleIds = Array.from(new Set(suggestions.flatMap((suggestion) => suggestion.articleIds)))
  if (articleIds.length === 0) return

  const { error } = await supabase
    .from('raw_articles')
    .update({
      suggestion_state: 'suggested',
      suggestion_last_checked_at: new Date().toISOString(),
    })
    .in('id', articleIds)

  if (error) {
    console.error('[suggest-clusters] raw_articles suggestion_state 업데이트 실패:', error.message)
  }
}