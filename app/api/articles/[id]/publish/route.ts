import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { triggerDeployHook } from '@/lib/deploy-hook'

type ClusterArticleRow = {
  raw_article_id: string
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

  const publishedAt = new Date().toISOString()
  const { data, error } = await supabase
    .from('articles')
    .update({
      published: true,
      published_at: publishedAt,
    })
    .eq('id', id)
    .select('id, title, content, published, published_at, created_at, cluster_id, image_url, slug, category, genre')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!data) {
    return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 })
  }

  if (data.cluster_id) {
    const rawArticleUpdateError = await markClusterRawArticlesUsed(data.cluster_id, publishedAt)
    if (rawArticleUpdateError) {
      console.error('[publish] raw_articles suggestion_state 업데이트 실패:', rawArticleUpdateError)
      return NextResponse.json({ article: data, rawArticleUpdateError }, { status: 500 })
    }
  }

  await triggerDeployHook()

  return NextResponse.json({ article: data })
}
