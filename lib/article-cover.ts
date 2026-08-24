import { isSafeArticleUrl } from '@/lib/article-blocks'
import { extractFirstMarkdownImage } from '@/lib/article-body'

export type ArticleCoverImageMode = 'auto' | 'none' | 'custom' | null

export function shouldShowCoverInArticle(value: boolean | null | undefined): boolean {
  return value !== false
}

export function isArticleCoverImageMode(value: unknown): value is ArticleCoverImageMode {
  return value === null || value === 'auto' || value === 'none' || value === 'custom'
}

export function isUsableCoverUrl(value: string | null | undefined): value is string {
  if (!value || !isSafeArticleUrl(value)) return false
  return !value.toLowerCase().includes('static.ra.co/images/')
}

export function resolveArticleCoverImage(input: {
  mode: ArticleCoverImageMode
  articleImageUrl?: string | null
  clusterImageUrl?: string | null
  inlineImageUrl?: string | null
}): string | null {
  if (input.mode === 'none') return null
  if (input.mode === 'custom') {
    return isUsableCoverUrl(input.articleImageUrl) ? input.articleImageUrl : null
  }
  if (isUsableCoverUrl(input.articleImageUrl)) return input.articleImageUrl
  if (isUsableCoverUrl(input.clusterImageUrl)) return input.clusterImageUrl
  return isUsableCoverUrl(input.inlineImageUrl) ? input.inlineImageUrl : null
}

export function resolveArticleListCoverImage(input: {
  mode: ArticleCoverImageMode
  articleImageUrl?: string | null
  clusterImageUrl?: string | null
  content: string
}): string | null {
  return resolveArticleCoverImage({
    ...input,
    inlineImageUrl: extractFirstMarkdownImage(input.content),
  })
}
