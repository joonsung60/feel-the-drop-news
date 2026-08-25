import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { triggerDeployHook } from '@/lib/deploy-hook'
import { completeArticleUnpublish } from '@/lib/article-unpublish'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
  }

  const { data: existing, error: fetchError } = await supabase
    .from('articles')
    .select('id, published')
    .eq('id', id)
    .maybeSingle()

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 })
  }

  if (!existing) {
    return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 })
  }

  if (!existing.published) {
    return NextResponse.json({ error: '이미 게시 취소된 기사입니다.' }, { status: 400 })
  }

  const result = await completeArticleUnpublish({
    updateArticle: async () => {
      const { data, error } = await supabase
        .from('articles')
        .update({ published: false })
        .eq('id', id)
        .select('id, title, content, published, published_at, created_at, updated_at, cluster_id, image_url, slug, category, genre')
        .maybeSingle()
      return { data, error }
    },
    triggerDeploy: triggerDeployHook,
  })

  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({ article: result.article, deploy: result.deploy })
}
