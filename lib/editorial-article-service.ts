import type { ArticleBlockDocument } from '@/lib/article-blocks'
import { projectBlocksToContent } from '@/lib/article-blocks'
import type { ArticleCoverImageMode } from '@/lib/article-cover'

export type EditorialArticleInput = {
  title: string
  category: string | null
  genre: string | null
  slug: string | null
  coverImageMode: Exclude<ArticleCoverImageMode, null>
  showCoverInArticle: boolean
  imageUrl: string | null
  coverImagePath: string | null
  contentBlocks: ArticleBlockDocument
}

type MutationResult<T> = { data: T | null; error: string | null }

export async function createEditorialDraft<T>(
  input: EditorialArticleInput,
  insert: (payload: Record<string, unknown>) => Promise<MutationResult<T>>
): Promise<MutationResult<T>> {
  return insert({
    title: input.title,
    category: input.category,
    genre: input.genre,
    slug: input.slug,
    cover_image_mode: input.coverImageMode,
    show_cover_in_article: input.showCoverInArticle,
    image_url: input.imageUrl,
    cover_image_path: input.coverImagePath,
    cluster_id: null,
    content: projectBlocksToContent(input.contentBlocks),
    content_blocks: input.contentBlocks,
    published: false,
  })
}

export async function saveEditorialArticle<T>(
  input: EditorialArticleInput & { id: string; published: boolean },
  dependencies: {
    update: (payload: Record<string, unknown>) => Promise<MutationResult<T>>
    triggerDeploy: () => Promise<unknown>
  }
): Promise<MutationResult<T>> {
  const result = await dependencies.update({
    title: input.title,
    category: input.category,
    genre: input.genre,
    slug: input.slug,
    cover_image_mode: input.coverImageMode,
    show_cover_in_article: input.showCoverInArticle,
    image_url: input.imageUrl,
    cover_image_path: input.coverImagePath,
    content: projectBlocksToContent(input.contentBlocks),
    content_blocks: input.contentBlocks,
    updated_at: new Date().toISOString(),
  })
  if (!result.error && result.data && input.published) await dependencies.triggerDeploy()
  return result
}
