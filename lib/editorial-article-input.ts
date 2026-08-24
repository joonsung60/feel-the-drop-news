import {
  validateArticleBlockDocument,
  type ArticleBlockDocument,
} from '@/lib/article-blocks'
import { isArticleCoverImageMode, isUsableCoverUrl, type ArticleCoverImageMode } from '@/lib/article-cover'

export type ValidatedEditorialArticleInput = {
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

function optionalString(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized || null
}

export function validateEditorialArticleInput(value: unknown):
  | { ok: true; input: ValidatedEditorialArticleInput }
  | { ok: false; error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: '요청 본문은 객체여야 합니다.' }
  }
  const body = value as Record<string, unknown>
  const allowed = ['title', 'category', 'genre', 'slug', 'coverImageMode', 'showCoverInArticle', 'imageUrl', 'coverImagePath', 'contentBlocks']
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
  if (unknown.length > 0 || allowed.some((key) => !(key in body))) {
    return { ok: false, error: '허용된 필드를 정확히 전달해야 합니다.' }
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title.length < 4) return { ok: false, error: '제목은 4자 이상이어야 합니다.' }
  const category = optionalString(body.category)
  const genre = optionalString(body.genre)
  const slug = optionalString(body.slug)
  const imageUrl = optionalString(body.imageUrl)
  const coverImagePath = optionalString(body.coverImagePath)
  if (category === undefined || genre === undefined || slug === undefined || imageUrl === undefined || coverImagePath === undefined) {
    return { ok: false, error: '선택 필드는 문자열 또는 null이어야 합니다.' }
  }
  if (slug && (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80)) {
    return { ok: false, error: 'slug는 영문 소문자, 숫자, 하이픈만 사용해 80자 이내로 입력하세요.' }
  }
  if (!isArticleCoverImageMode(body.coverImageMode) || body.coverImageMode === null) {
    return { ok: false, error: '대표 이미지 설정이 올바르지 않습니다.' }
  }
  if (typeof body.showCoverInArticle !== 'boolean') {
    return { ok: false, error: '기사 상단 대표 이미지 표시 설정이 올바르지 않습니다.' }
  }
  if (imageUrl && !isUsableCoverUrl(imageUrl)) return { ok: false, error: '대표 이미지 URL이 올바르지 않습니다.' }
  if (coverImagePath && !/^editorial\/\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i.test(coverImagePath)) {
    return { ok: false, error: '관리 이미지 경로가 올바르지 않습니다.' }
  }
  if (body.coverImageMode === 'custom' && !imageUrl) return { ok: false, error: '직접 업로드 또는 외부 URL을 입력하세요.' }
  if (coverImagePath && !imageUrl) return { ok: false, error: '관리 이미지 경로에는 대표 이미지 URL이 필요합니다.' }
  const document = validateArticleBlockDocument(body.contentBlocks)
  if (!document.ok) return { ok: false, error: document.error }
  return { ok: true, input: { title, category, genre, slug, coverImageMode: body.coverImageMode, showCoverInArticle: body.showCoverInArticle, imageUrl, coverImagePath, contentBlocks: document.document } }
}
