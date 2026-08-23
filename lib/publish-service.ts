import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { triggerDeployHook } from '@/lib/deploy-hook'
import entityDict from '@/lib/edm-entities-v2.json'
import entitySurfacePolicy from '@/lib/entity-surface-policy.json'
import { buildGroundingEvidence, validateArticleGrounding } from '@/lib/article-grounding'
import { cleanArticleText } from '@/lib/article-extraction'
import { orchestrateArticlePublish } from '@/lib/publish-article'

type ArticleRow = {
  id: string; title: string; content: string; published: boolean; published_at: string | null
  created_at: string; updated_at: string | null; cluster_id: string | null
  image_url: string | null; slug: string; category: string; genre: string | null
}
type PublishError = { status: number; body: Record<string, unknown> }
export type PreparedPublish = { article: ArticleRow }

async function validateClusterArticle(article: ArticleRow) {
  if (!article.cluster_id) return { ok: true, issues: [] }
  const { data: links, error: linkError } = await supabase.from('cluster_articles')
    .select('raw_article_id').eq('cluster_id', article.cluster_id)
  if (linkError) throw linkError
  const rawIds = Array.from(new Set((links ?? []).map((row) => row.raw_article_id as string).filter(Boolean)))
  if (rawIds.length === 0) {
    return validateArticleGrounding({ sourceEvidence: '', title: article.title, content: article.content, entities: entityDict.entities, policy: entitySurfacePolicy })
  }
  const { data: raws, error: rawError } = await supabase.from('raw_articles').select('title, content').in('id', rawIds)
  if (rawError) throw rawError
  return validateArticleGrounding({
    sourceEvidence: buildGroundingEvidence((raws ?? []).map((raw) => ({
      title: cleanArticleText(raw.title ?? '', 500),
      content: cleanArticleText(raw.content ?? '', 2500, { preserveParagraphBreaks: true }),
    }))),
    title: article.title, content: article.content, entities: entityDict.entities, policy: entitySurfacePolicy,
  })
}

export async function prepareArticlePublish(id: string): Promise<PreparedPublish | PublishError> {
  const { data, error } = await supabase.from('articles')
    .select('id, title, content, published, published_at, created_at, updated_at, cluster_id, image_url, slug, category, genre')
    .eq('id', id).maybeSingle()
  if (error) return { status: 500, body: { error: error.message } }
  if (!data) return { status: 404, body: { error: '기사를 찾을 수 없습니다.' } }
  const article = data as ArticleRow
  if (article.published) return { status: 409, body: { code: 'ARTICLE_ALREADY_PUBLISHED', error: '이미 게시된 기사입니다.' } }
  const grounding = await validateClusterArticle(article)
  if (!grounding.ok) {
    return { status: 409, body: { code: 'ARTICLE_GROUNDING_FAILED', error: '원문에 근거하지 않은 EDM 고유명사가 있어 게시할 수 없습니다.', issues: grounding.issues } }
  }
  return { article }
}

async function markRawArticlesUsed(clusterId: string, usedAt: string): Promise<string | null> {
  const { data, error } = await supabase.from('cluster_articles').select('raw_article_id').eq('cluster_id', clusterId)
  if (error) return error.message
  const ids = Array.from(new Set((data ?? []).map((row) => row.raw_article_id as string).filter(Boolean)))
  if (ids.length === 0) return null
  const { error: updateError } = await supabase.from('raw_articles')
    .update({ suggestion_state: 'used', suggestion_used_at: usedAt }).in('id', ids)
  return updateError?.message ?? null
}

export async function executePreparedPublish(prepared: PreparedPublish, deploy: boolean) {
  const article = prepared.article
  const publishedAt = new Date().toISOString()
  return orchestrateArticlePublish({
    clusterId: article.cluster_id,
    validateGrounding: async () => ({ ok: true, issues: [] }),
    publishArticle: async () => {
      let query = supabase.from('articles').update({ published: true, published_at: publishedAt })
        .eq('id', article.id).eq('published', false)
      query = article.updated_at === null ? query.is('updated_at', null) : query.eq('updated_at', article.updated_at)
      const { data, error } = await query.select('id, title, content, published, published_at, created_at, updated_at, cluster_id, image_url, slug, category, genre').maybeSingle()
      return { article: data, error: error?.message ?? null }
    },
    markRawArticlesUsed: () => article.cluster_id ? markRawArticlesUsed(article.cluster_id, publishedAt) : Promise.resolve(null),
    triggerDeploy: deploy ? triggerDeployHook : async () => ({ success: true }),
  })
}

export async function executePreparedPublishBatch(
  preparedArticles: PreparedPublish[],
  daily?: { runId: string; displayOrders: number[] },
): Promise<{ articles: ArticleRow[]; error: string | null }> {
  const requestedArticles = preparedArticles.map(({ article }) => ({
    id: article.id,
    updated_at: article.updated_at,
  }))
  const { data, error } = daily
    ? await supabase.rpc('publish_daily_article_batch', {
      requested_run_id: daily.runId,
      requested_display_orders: daily.displayOrders,
      requested_articles: requestedArticles,
    })
    : await supabase.rpc('publish_article_batch', { requested_articles: requestedArticles })
  if (error) return { articles: [], error: error.message }
  if (!Array.isArray(data)) {
    return { articles: [], error: '일괄 게시 RPC가 기사 배열을 반환하지 않았습니다.' }
  }
  return { articles: data as ArticleRow[], error: null }
}

export function isPublishError(value: PreparedPublish | PublishError): value is PublishError {
  return 'status' in value
}
