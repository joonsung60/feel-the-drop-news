import { NextRequest, NextResponse } from 'next/server'
import { authorizeAdminRequest } from '@/lib/admin-api-auth'
import { validateEditorialArticleInput } from '@/lib/editorial-article-input'
import { legacyContentToBlockDocument, validateArticleBlockDocument } from '@/lib/article-blocks'
import { saveEditorialArticle } from '@/lib/editorial-article-service'
import { triggerDeployHook } from '@/lib/deploy-hook'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

const ARTICLE_SELECT =
  'id, title, content, content_blocks, published, published_at, created_at, updated_at, cluster_id, image_url, slug, category, genre'

async function loadArticle(id: string) {
  return supabase.from('articles').select(ARTICLE_SELECT).eq('id', id).maybeSingle()
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response
  const { id } = await params
  const { data, error } = await loadArticle(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 })
  const storedDocument = validateArticleBlockDocument(data.content_blocks)
  return NextResponse.json({
    article: data,
    contentBlocks: storedDocument.ok
      ? storedDocument.document
      : legacyContentToBlockDocument(data.content),
  })
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authorization = await authorizeAdminRequest(request)
  if (!authorization.ok) return authorization.response
  const { id } = await params
  const body = await request.json().catch(() => null)
  const validated = validateEditorialArticleInput(body)
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 })
  const existing = await loadArticle(id)
  if (existing.error) return NextResponse.json({ error: existing.error.message }, { status: 500 })
  if (!existing.data) return NextResponse.json({ error: '기사를 찾을 수 없습니다.' }, { status: 404 })

  const result = await saveEditorialArticle(
    { ...validated.input, id, published: Boolean(existing.data.published) },
    {
      update: async (payload) => {
        const { data, error } = await supabase.from('articles').update(payload)
          .eq('id', id).select(ARTICLE_SELECT).maybeSingle()
        return { data, error: error?.message ?? null }
      },
      triggerDeploy: triggerDeployHook,
    }
  )
  if (result.error) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ article: result.data })
}
