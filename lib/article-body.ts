export type LegacyArticleBlock =
  | { type: 'paragraph'; text: string }
  | {
      type: 'attribution'
      textBeforeLink: string
      linkText: string
      href: string
      textAfterLink: string
    }
  | { type: 'image'; alt: string; src: string }

function splitTextBlocks(text: string): LegacyArticleBlock[] {
  return text.split('\n\n').map((value) => value.trim()).filter(Boolean).map((paragraph) => {
    const attributionMatch = paragraph.match(
      /^\*([^\n]*?)\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)([^\n]*?)\*$/
    )

    if (attributionMatch) {
      return {
        type: 'attribution' as const,
        textBeforeLink: attributionMatch[1],
        linkText: attributionMatch[2],
        href: attributionMatch[3],
        textAfterLink: attributionMatch[4],
      }
    }

    return { type: 'paragraph' as const, text: paragraph }
  })
}

export function parseLegacyArticleBody(
  text: string,
  leadingImageUrl?: string | null
): LegacyArticleBlock[] {
  if (!text?.trim()) return []

  const imagePattern = /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g
  const blocks: LegacyArticleBlock[] = []
  const normalizedLeadingImageUrl = leadingImageUrl?.trim()

  if (normalizedLeadingImageUrl && !text.includes(normalizedLeadingImageUrl)) {
    blocks.push({ type: 'image', alt: '', src: normalizedLeadingImageUrl })
  }

  let cursor = 0
  for (const match of text.matchAll(imagePattern)) {
    const index = match.index ?? 0
    blocks.push(...splitTextBlocks(text.slice(cursor, index)))
    blocks.push({
      type: 'image',
      alt: match[1].trim(),
      src: match[2].trim(),
    })
    cursor = index + match[0].length
  }

  blocks.push(...splitTextBlocks(text.slice(cursor)))
  return blocks
}

export function extractFirstMarkdownImage(content: string): string | null {
  const match = content.match(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/)
  return match?.[1] ?? null
}
