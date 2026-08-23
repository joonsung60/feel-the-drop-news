import { blocksToPlainText, validateArticleBlockDocument } from '@/lib/article-blocks'

const DEFAULT_MAX_LENGTH = 180

export function articleContentToPlainText(
  content: string,
  contentBlocks?: unknown | null
): string {
  const validated = validateArticleBlockDocument(contentBlocks)
  if (validated.ok) {
    return blocksToPlainText(validated.document).replace(/\s+/g, ' ').trim()
  }

  return content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{2,3}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-+*]|\d+\.)\s+/gm, '')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

export function createArticleExcerpt(
  content: string,
  maxLength = DEFAULT_MAX_LENGTH,
  contentBlocks?: unknown | null
): string {
  const normalized = articleContentToPlainText(content, contentBlocks)

  if (normalized.length <= maxLength) return normalized

  const candidate = normalized.slice(0, maxLength + 1)
  const boundary = candidate.search(/\s+\S*$/)
  const excerpt = boundary >= Math.floor(maxLength * 0.75)
    ? candidate.slice(0, boundary)
    : normalized.slice(0, maxLength)

  return `${excerpt.trimEnd()}…`
}
