import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { validateArticleBlockDocument } from '@/lib/article-blocks'
import { collectManagedEditorialPaths } from '@/lib/editorial-media'
import { cleanupUnreferencedEditorialMedia } from '@/lib/editorial-media-cleanup'

type ClusterArticleRow = { raw_article_id: string }
export type DeleteDraftResult = {
  status: number
  body: Record<string, unknown>
  deleted: boolean
}

async function resetClusterRawArticlesForDraftDelete(clusterId: string): Promise<string | null> {
  const { data, error } = await supabase.from('cluster_articles')
    .select('raw_article_id').eq('cluster_id', clusterId)
  if (error) return error.message
  const ids = Array.from(new Set(((data ?? []) as ClusterArticleRow[])
    .map((row) => row.raw_article_id).filter(Boolean)))
  if (ids.length === 0) return null
  const { error: updateError } = await supabase.from('raw_articles')
    .update({ suggestion_state: 'new', suggestion_used_at: null }).in('id', ids)
  return updateError?.message ?? null
}

export async function deleteDraftArticle(id: string): Promise<DeleteDraftResult> {
  const { data: article, error: fetchError } = await supabase.from('articles')
    .select('id, title, published, cluster_id, content_blocks, cover_image_path').eq('id', id).maybeSingle()
  if (fetchError) return { status: 500, body: { error: fetchError.message }, deleted: false }
  if (!article) return { status: 404, body: { error: '기사를 찾을 수 없습니다.' }, deleted: false }
  if (article.published) {
    return { status: 409, body: { error: '게시된 기사는 삭제할 수 없습니다.' }, deleted: false }
  }

  if (article.cluster_id) {
    const resetError = await resetClusterRawArticlesForDraftDelete(article.cluster_id)
    if (resetError) return { status: 500, body: { error: resetError }, deleted: false }
  }
  const { error: imageError } = await supabase.from('image_sources')
    .update({ generated_article_id: null, status: 'analyzed' }).eq('generated_article_id', id)
  if (imageError) return { status: 500, body: { error: imageError.message }, deleted: false }

  const { data: deleted, error: deleteError } = await supabase.from('articles')
    .delete().eq('id', id).eq('published', false).select('id').maybeSingle()
  if (deleteError) return { status: 500, body: { error: deleteError.message }, deleted: false }
  if (!deleted) return { status: 409, body: { error: '기사 상태가 변경되어 삭제하지 않았습니다.' }, deleted: false }
  const document = validateArticleBlockDocument(article.content_blocks)
  const managedPaths = collectManagedEditorialPaths(document.ok ? document.document : null, article.cover_image_path)
  await cleanupUnreferencedEditorialMedia(managedPaths)
  return { status: 200, body: { deleted: true, article }, deleted: true }
}
