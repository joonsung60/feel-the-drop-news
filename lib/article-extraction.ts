const BOILERPLATE_PATTERNS = [
  /\b(login|search|members login|become a member|advertise|submit music|contact us)\b/gi,
  /\b(share|email|facebook|twitter|reddit|pinterest|whatsapp|telegram)\b/gi,
  /\b(previous article|next article|related articles|more from author|comments are closed)\b/gi,
  /\b(sign up|subscribe|tags|just released|claim this offer|read more)\b/gi,
  /\b(news tracks features mixes events genres)\b/gi,
  /\b(acid house ambient music balearica deep house disco\/edits electronica garage house soulful house synth tech house techno uk garage)\b/gi,
  /\b(deep house tracks reviews|tracks reviews|features mixes events)\b/gi,
]

const STOP_SECTION_PATTERNS = [
  /\b(previous article|next article)\b/i,
  /\b(related articles|more from author)\b/i,
  /\b(comments are closed|just released)\b/i,
  /\b(sign up|subscribe)\b/i,
]

function decodeHtmlEntities(text: string): string {
  const namedEntities: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(lower.slice(2), 16))
    }
    if (lower.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(lower.slice(1), 10))
    }
    return namedEntities[lower] ?? match
  })
}

function stripHtmlToText(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(br|\/p|\/h[1-6]|\/li|\/blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type CleanArticleTextOptions = {
  preserveParagraphBreaks?: boolean
}

export function cleanArticleText(
  text: string,
  maxLength = 10000,
  options: CleanArticleTextOptions = {}
): string {
  const stopIndex = STOP_SECTION_PATTERNS
    .map((pattern) => text.search(pattern))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0]

  let cleaned = stopIndex === undefined ? text : text.slice(0, stopIndex)

  // Some sources store a full-page text dump on a single line. Restore light
  // boundaries around common article markers before filtering line-by-line.
  cleaned = cleaned
    .replace(/\b(By [A-Z][A-Za-z .'-]+ - [A-Z][a-z]+ \d{1,2}, \d{4})\b/g, '\n$1\n')
    .replace(/\b(Tracklisting|Disclosure Statement|Previous Coverage)\b/gi, '\n$1\n')

  for (const pattern of BOILERPLATE_PATTERNS) {
    cleaned = cleaned.replace(pattern, ' ')
  }

  const normalizedLines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !/^(news|tracks|features|mixes|events|genres)$/i.test(line))

  const normalized = options.preserveParagraphBreaks
    ? normalizedLines.join('\n').replace(/\n{3,}/g, '\n\n')
    : normalizedLines.filter((line) => line.length > 0).join('\n')

  return normalized
    .replace(/[ \t\f\v]+/g, ' ')
    .slice(0, maxLength)
    .trim()
}

function removeBoilerplate(text: string): string {
  return cleanArticleText(text)
}

function getMetaContent(html: string, key: string, value: string): string | null {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? []
  const attrPattern = /([a-z_:.-]+)\s*=\s*["']([^"']*)["']/gi

  for (const tag of metaTags) {
    const attrs: Record<string, string> = {}
    for (const match of tag.matchAll(attrPattern)) {
      attrs[match[1].toLowerCase()] = match[2]
    }

    if (attrs[key]?.toLowerCase() === value && attrs.content) {
      return decodeHtmlEntities(attrs.content).trim()
    }
  }

  return null
}

function cleanArticleTitle(title: string): string {
  return decodeHtmlEntities(title)
    .replace(/\s+/g, ' ')
    .replace(/\s+[-|–—]\s+(Bandcamp Daily|Beatportal|Attack Magazine|Inverted Audio|Mixmag|DJ Mag)$/i, '')
    .trim()
}

function isBadPageTitle(title: string): boolean {
  return /^(page not found|not found|404|403|forbidden|access denied)\b/i.test(title.trim())
}

export function isUrlLikeTitle(title: string): boolean {
  const trimmed = title.trim().toLowerCase()
  return /^https?:\/\//.test(trimmed)
    || /^www\./.test(trimmed)
    || /\bhttps?\b/.test(trimmed)
    || /\bwww\b/.test(trimmed)
    || /\b[a-z0-9-]+\.(com|net|org|co|uk|de|fr|io|fm)\b/.test(trimmed)
}

export function titleFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url)
    const slug = parsed.pathname
      .split('/')
      .filter(Boolean)
      .pop()

    if (!slug) {
      return null
    }

    const title = slug
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim()

    return title.length >= 8 ? title : null
  } catch {
    return null
  }
}

export function extractArticleTitle(html: string, fallbackUrl?: string): string | null {
  const ogTitle = getMetaContent(html, 'property', 'og:title')
  const twitterTitle = getMetaContent(html, 'name', 'twitter:title')
  const h1Match = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)

  const candidates = [
    ogTitle,
    twitterTitle,
    h1Match ? stripHtmlToText(h1Match[1]) : null,
    titleMatch ? stripHtmlToText(titleMatch[1]) : null,
  ]

  for (const candidate of candidates) {
    if (!candidate) continue
    const title = cleanArticleTitle(candidate)
    if (title.length >= 8 && !isUrlLikeTitle(title) && !isBadPageTitle(title)) {
      return title.slice(0, 220)
    }
  }

  return fallbackUrl ? titleFromUrl(fallbackUrl) : null
}

export function extractImageUrl(html: string): string | null {
  return getMetaContent(html, 'property', 'og:image')
    ?? getMetaContent(html, 'name', 'twitter:image')
}

const EMBED_URL_PATTERNS = [
  /https?:\/\/(?:www\.|m\.)?youtube\.com\/watch\?[^\s"'<>]*v=[\w-]+[^\s"'<>]*/i,
  /https?:\/\/(?:www\.)?youtu\.be\/[\w-]+(?:[^\s"'<>]*)?/i,
  /https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/[\w-]+(?:[^\s"'<>]*)?/i,
  /https?:\/\/(?:[\w-]+\.)*soundcloud\.com\/[^\s"'<>]+/i,
  /https?:\/\/open\.spotify\.com\/(?:track|album|playlist)\/[A-Za-z0-9]+(?:[^\s"'<>]*)?/i,
]

export function extractEmbedUrl(html: string): string | null {
  let earliest: { index: number; url: string } | null = null
  for (const pattern of EMBED_URL_PATTERNS) {
    const match = pattern.exec(html)
    if (match && (earliest === null || match.index < earliest.index)) {
      earliest = { index: match.index, url: match[0] }
    }
  }
  return earliest?.url ?? null
}

function scoreArticleText(text: string, attrs = ''): number {
  const normalized = text.toLowerCase()
  const boilerplateHits = BOILERPLATE_PATTERNS.reduce((count, pattern) => {
    pattern.lastIndex = 0
    return count + (normalized.match(pattern)?.length ?? 0)
  }, 0)
  const articleHint = /\b(article|post|entry|content|story|single)\b/i.test(attrs) ? 500 : 0
  const paragraphScore = (text.match(/\n/g)?.length ?? 0) * 80

  return text.length + paragraphScore + articleHint - boilerplateHits * 250
}

export function extractArticleText(html: string, maxLength = 20000): string {
  const pageWithoutChrome = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, ' ')

  const candidates: { text: string; score: number }[] = []
  const candidatePattern = /<(article|main|section)\b([^>]*)>([\s\S]*?)<\/\1>/gi

  for (const match of pageWithoutChrome.matchAll(candidatePattern)) {
    const text = removeBoilerplate(stripHtmlToText(match[3]))
    if (text.length >= 250) {
      candidates.push({ text, score: scoreArticleText(text, match[2]) })
    }
  }

  const description = getMetaContent(html, 'property', 'og:description')
    ?? getMetaContent(html, 'name', 'description')
  if (description && description.length >= 80) {
    candidates.push({ text: description, score: description.length })
  }

  const fallback = removeBoilerplate(stripHtmlToText(pageWithoutChrome))
  if (fallback.length >= 80) {
    candidates.push({ text: fallback, score: scoreArticleText(fallback) - 600 })
  }

  return (candidates.sort((a, b) => b.score - a.score)[0]?.text ?? '')
    .slice(0, maxLength)
    .trim()
}
