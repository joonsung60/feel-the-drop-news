import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { triggerDeployHook } from '@/lib/deploy-hook'
import entityDict from '@/lib/edm-entities-v2.json'
import entitySurfacePolicy from '@/lib/entity-surface-policy.json'
import { buildGroundingEvidence, validateArticleGrounding } from '@/lib/article-grounding'
import { cleanArticleText } from '@/lib/article-extraction'
import { orchestrateArticlePublish } from '@/lib/publish-article'

type ClusterArticleRow = {
  raw_article_id: string
}

type RawArticleGroundingRow = {
  title: string | null
  content: string | null
}

async function validateClusterArticleBeforePublish(article: {
  cluster_id: string
  title: string
  content: string
}) {
  const { data: clusterArticles, error: clusterError } = await supabase
    .from('cluster_articles')
    .select('raw_article_id')
    .eq('cluster_id', article.cluster_id)

  if (clusterError) throw clusterError
  const rawArticleIds = Array.from(new Set(
    ((clusterArticles ?? []) as ClusterArticleRow[]).map((row) => row.raw_article_id).filter(Boolean)
  ))
  if (rawArticleIds.length === 0) {
    return validateArticleGrounding({
      sourceEvidence: '',
      title: article.title,
      content: article.content,
      entities: entityDict.entities,
      policy: entitySurfacePolicy,
    })
  }

  const { data: rawArticles, error: rawError } = await supabase
    .from('raw_articles')
    .select('title, content')
    .in('id', rawArticleIds)
  if (rawError) throw rawError

  return validateArticleGrounding({
    sourceEvidence: buildGroundingEvidence(((rawArticles ?? []) as RawArticleGroundingRow[]).map((raw) => ({
      title: cleanArticleText(raw.title ?? '', 500),
      content: cleanArticleText(raw.content ?? '', 2500, { preserveParagraphBreaks: true }),
    }))),
    title: article.title,
    content: article.content,
    entities: entityDict.entities,
    policy: entitySurfacePolicy,
  })
}

async function markClusterRawArticlesUsed(clusterId: string, usedAt: string): Promise<string | null> {
  const { data: clusterArticles, error: clusterError } = await supabase
    .from('cluster_articles')
    .select('raw_article_id')
    .eq('cluster_id', clusterId)

  if (clusterError) return clusterError.message

  const rawArticleIds = Array.from(new Set(
    ((clusterArticles ?? []) as ClusterArticleRow[])
      .map((row) => row.raw_article_id)
      .filter(Boolean)
  ))

  if (rawArticleIds.length === 0) return null

  const { error: rawUpdateError } = await supabase
    .from('raw_articles')
    .update({
      suggestion_state: 'used',
      suggestion_used_at: usedAt,
    })
    .in('id', rawArticleIds)

  return rawUpdateError?.message ?? null
}

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  }

  const { data: currentArticle, error: fetchError } = await supabase
    .from('articles')
    .select('id, title, content, published, published_at, created_at, updated_at, cluster_id, image_url, slug, category, genre')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!currentArticle) {
    return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 })
  }

  const publishedAt = new Date().toISOString()
  try {
    const result = await orchestrateArticlePublish({
      clusterId: currentArticle.cluster_id,
      validateGrounding: async () => currentArticle.cluster_id
        ? validateClusterArticleBeforePublish({
            cluster_id: currentArticle.cluster_id,
            title: currentArticle.title,
            content: currentArticle.content,
          })
        : { ok: true, issues: [] },
      publishArticle: async () => {
        let updateQuery = supabase
          .from('articles')
          .update({ published: true, published_at: publishedAt })
          .eq('id', id)
        updateQuery = currentArticle.updated_at === null
          ? updateQuery.is('updated_at', null)
          : updateQuery.eq('updated_at', currentArticle.updated_at)
        const { data, error } = await updateQuery
          .select('id, title, content, published, published_at, created_at, updated_at, cluster_id, image_url, slug, category, genre')
          .maybeSingle()
        return { article: data, error: error?.message ?? null }
      },
      markRawArticlesUsed: () => currentArticle.cluster_id
        ? markClusterRawArticlesUsed(currentArticle.cluster_id, publishedAt)
        : Promise.resolve(null),
      triggerDeploy: triggerDeployHook,
    })

    if (result.type === 'grounding_failed') {
      return NextResponse.json({
        code: result.code,
        error: '원문에 근거하지 않은 EDM 고유명사가 있어 게시할 수 없습니다.',
        issues: result.grounding.issues,
      }, { status: result.status })
    }
    if (result.type === 'article_changed') {
      return NextResponse.json({
        code: result.code,
        error: '검증 이후 기사 내용이 변경되었습니다. 다시 확인한 뒤 게시하세요.',
      }, { status: result.status })
    }
    if (result.type === 'article_update_failed') {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    if (result.type === 'raw_article_update_failed') {
      console.error('[publish] raw_articles suggestion_state 업데이트 실패:', result.error)
      return NextResponse.json({ article: result.article, rawArticleUpdateError: result.error }, { status: 500 })
    }
    return NextResponse.json({ article: result.article })
  } catch (publishError) {
    return NextResponse.json({ error: String(publishError) }, { status: 500 })
  }
}
