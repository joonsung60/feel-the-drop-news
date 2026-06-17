import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

type ClusterRequest = {
  topic?: string
  keywords?: string[]
  articleIds?: string[]
  matchMode?: 'or' | 'and'
}

type MatchedArticle = {
  id: string
  title: string | null
  url: string
}

function normalizeKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) {
    return []
  }

  return keywords
    .filter((keyword): keyword is string => typeof keyword === 'string')
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0)
}

function sanitizeKeywordForFilter(keyword: string): string {
  return keyword.replace(/[(),]/g, ' ').replace(/\s+/g, ' ').trim()
}

function normalizeArticleIds(articleIds: unknown): string[] {
  if (!Array.isArray(articleIds)) {
    return []
  }

  return Array.from(new Set(articleIds
    .filter((articleId): articleId is string => typeof articleId === 'string')
    .map((articleId) => articleId.trim())
    .filter((articleId) => articleId.length > 0)))
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as ClusterRequest
    const topic = body.topic?.trim()
    const keywords = normalizeKeywords(body.keywords)
    const articleIds = normalizeArticleIds(body.articleIds)
    const matchMode = body.matchMode === 'and' ? 'and' : 'or'

    if (!topic || (keywords.length === 0 && articleIds.length === 0)) {
      return NextResponse.json({ error: '토픽과 키워드 또는 기사 ID를 입력하세요.' }, { status: 400 })
    }

    let matchedArticles: MatchedArticle[] | null = null
    let error = null

    if (articleIds.length > 0) {
      const result = await supabase
        .from('raw_articles')
        .select('id, title, url')
        .in('id', articleIds)
        .order('published_at', { ascending: false })

      matchedArticles = result.data as MatchedArticle[] | null
      error = result.error
    } else {
      const keywordConditions = keywords
        .map(sanitizeKeywordForFilter)
        .filter((keyword) => keyword.length > 0)
        .map((keyword) => `title.ilike.%${keyword}%,content.ilike.%${keyword}%`)

      if (keywordConditions.length === 0) {
        return NextResponse.json({ error: '검색 가능한 키워드가 없습니다.' }, { status: 400 })
      }

      let query = supabase
        .from('raw_articles')
        .select('id, title, url')
        .order('published_at', { ascending: false })
        .limit(20)

      if (matchMode === 'and') {
        for (const condition of keywordConditions) {
          query = query.or(condition)
        }
      } else {
        query = query.or(keywordConditions.join(','))
      }

      const result = await query
      matchedArticles = result.data as MatchedArticle[] | null
      error = result.error
    }

    if (error) throw error
    if (!matchedArticles || matchedArticles.length === 0) {
      return NextResponse.json({ error: '매칭된 기사가 없습니다.' }, { status: 404 })
    }

    // 클러스터 생성
    const { data: cluster, error: clusterError } = await supabase
      .from('article_clusters')
      .insert({ topic, keywords })
      .select()
      .single()

    if (clusterError) throw clusterError

    // 클러스터에 기사 연결
    const clusterArticles = matchedArticles.map((article) => ({
      cluster_id: cluster.id,
      raw_article_id: article.id,
    }))

    const { error: linkError } = await supabase
      .from('cluster_articles')
      .insert(clusterArticles)

    if (linkError) throw linkError

    return NextResponse.json({
      success: true,
      clusterId: cluster.id,
      matchMode,
      matched: matchedArticles.length,
      articles: matchedArticles.map((article) => ({ title: article.title, url: article.url })),
    })

  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 })
  }
}
