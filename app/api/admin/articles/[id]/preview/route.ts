import { NextRequest, NextResponse } from 'next/server'
import { authorizeAdminRequest } from '@/lib/admin-api-auth'
import { extractFirstMarkdownImage } from '@/lib/article-body'
import { isUsableImageUrl, loadClusterImageUrl } from '@/lib/articles'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

const ARTICLE_SELECT =
  'id, title, content, published, published_at, created_at, updated_at, cluster_id, image_url, slug, category, genre'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })

  const { data: article, error } = await supabase
    .from('articles')
    .select(ARTICLE_SELECT)
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!article) return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 })

  const leadingImageUrl = isUsableImageUrl(article.image_url)
    ? article.image_url
    : (await loadClusterImageUrl(article.cluster_id)) ??
      extractFirstMarkdownImage(article.content)

  return NextResponse.json({ article, leadingImageUrl })
}
