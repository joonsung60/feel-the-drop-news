import { NextRequest, NextResponse } from 'next/server'
import { authorizeAdminRequest } from '@/lib/admin-api-auth'
import { validateEditorialArticleInput } from '@/lib/editorial-article-input'
import { legacyContentToBlockDocument, validateArticleBlockDocument } from '@/lib/article-blocks'
import { collectManagedEditorialPaths } from '@/lib/editorial-media'
import { cleanupUnreferencedEditorialMedia } from '@/lib/editorial-media-cleanup'
import { extractFirstMarkdownImage } from '@/lib/article-body'
import { loadClusterImageUrl } from '@/lib/articles'
import { resolveArticleCoverImage } from '@/lib/article-cover'
import { saveEditorialArticle } from '@/lib/editorial-article-service'
import { triggerDeployHook } from '@/lib/deploy-hook'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

const ARTICLE_SELECT =
  'id, title, content, content_blocks, published, published_at, created_at, updated_at, cluster_id, image_url, cover_image_mode, cover_image_path, slug, category, genre'

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
  const clusterImageUrl = data.cover_image_mode === 'none' || data.cover_image_mode === 'custom'
    ? null : await loadClusterImageUrl(data.cluster_id)
  return NextResponse.json({
    article: data,
    leadingImageUrl: resolveArticleCoverImage({
      mode: data.cover_image_mode,
      articleImageUrl: data.image_url,
      clusterImageUrl,
      inlineImageUrl: extractFirstMarkdownImage(data.content),
    }),
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
  if (existing.data.published && validated.input.slug !== existing.data.slug) {
    return NextResponse.json({ error: '게시된 기사의 slug는 Editorial Editor에서 변경할 수 없습니다.', code: 'PUBLISHED_SLUG_IMMUTABLE' }, { status: 409 })
  }
  if (validated.input.slug && validated.input.slug !== existing.data.slug) {
    const { data: duplicate, error: duplicateError } = await supabase.from('articles')
      .select('id').eq('slug', validated.input.slug).neq('id', id).maybeSingle()
    if (duplicateError) return NextResponse.json({ error: duplicateError.message }, { status: 500 })
    if (duplicate) return NextResponse.json({ error: '이미 사용 중인 slug입니다.', code: 'SLUG_CONFLICT' }, { status: 409 })
  }

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
  if (result.data) {
    const oldDocument = validateArticleBlockDocument(existing.data.content_blocks)
    const previousPaths = collectManagedEditorialPaths(oldDocument.ok ? oldDocument.document : null, existing.data.cover_image_path)
    const nextPaths = collectManagedEditorialPaths(validated.input.contentBlocks, validated.input.coverImagePath)
    await cleanupUnreferencedEditorialMedia([...previousPaths].filter((path) => !nextPaths.has(path)))
  }
  return NextResponse.json({ article: result.data })
}
