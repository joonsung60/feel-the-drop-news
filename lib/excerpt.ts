const DEFAULT_MAX_LENGTH = 180

export function createArticleExcerpt(
  content: string,
  maxLength = DEFAULT_MAX_LENGTH
): string {
  const normalized = content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  if (normalized.length <= maxLength) return normalized

  const candidate = normalized.slice(0, maxLength + 1)
  const boundary = candidate.search(/\s+\S*$/)
  const excerpt = boundary >= Math.floor(maxLength * 0.75)
    ? candidate.slice(0, boundary)
    : normalized.slice(0, maxLength)

  return `${excerpt.trimEnd()}…`
}
