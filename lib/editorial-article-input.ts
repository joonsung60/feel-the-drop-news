import {
  validateArticleBlockDocument,
  type ArticleBlockDocument,
} from '@/lib/article-blocks'

export type ValidatedEditorialArticleInput = {
  title: string
  category: string | null
  genre: string | null
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
  const allowed = ['title', 'category', 'genre', 'contentBlocks']
  const unknown = Object.keys(body).filter((key) => !allowed.includes(key))
  if (unknown.length > 0 || allowed.some((key) => !(key in body))) {
    return { ok: false, error: '허용된 필드를 정확히 전달해야 합니다.' }
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title.length < 4) return { ok: false, error: '제목은 4자 이상이어야 합니다.' }
  const category = optionalString(body.category)
  const genre = optionalString(body.genre)
  if (category === undefined || genre === undefined) {
    return { ok: false, error: 'category와 genre는 문자열 또는 null이어야 합니다.' }
  }
  const document = validateArticleBlockDocument(body.contentBlocks)
  if (!document.ok) return { ok: false, error: document.error }
  return { ok: true, input: { title, category, genre, contentBlocks: document.document } }
}
