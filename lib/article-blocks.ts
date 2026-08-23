export type ArticleInline =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }

export type ArticleContentBlock =
  | { type: 'paragraph'; content: ArticleInline[] }
  | { type: 'heading'; level: 2 | 3; content: ArticleInline[] }
  | { type: 'list'; ordered: boolean; items: ArticleInline[][] }
  | { type: 'blockquote'; content: ArticleInline[] }
  | { type: 'attribution'; content: ArticleInline[] }
  | { type: 'image'; src: string; alt: string }

export type ArticleBlockDocument = {
  version: 1
  blocks: ArticleContentBlock[]
}

const BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'list', 'blockquote', 'attribution', 'image',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

export function isSafeArticleUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function validateInline(value: unknown): value is ArticleInline {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'text') {
    return hasOnlyKeys(value, ['type', 'text']) && typeof value.text === 'string'
  }
  if (value.type === 'link') {
    return hasOnlyKeys(value, ['type', 'text', 'href']) &&
      typeof value.text === 'string' &&
      typeof value.href === 'string' &&
      isSafeArticleUrl(value.href)
  }
  return false
}

function validateInlineArray(value: unknown): value is ArticleInline[] {
  return Array.isArray(value) && value.every(validateInline)
}

function validateBlock(value: unknown): value is ArticleContentBlock {
  if (!isRecord(value) || typeof value.type !== 'string' || !BLOCK_TYPES.has(value.type)) {
    return false
  }
  if (value.type === 'image') {
    return hasOnlyKeys(value, ['type', 'src', 'alt']) &&
      typeof value.src === 'string' && isSafeArticleUrl(value.src) &&
      typeof value.alt === 'string'
  }
  if (value.type === 'heading') {
    return hasOnlyKeys(value, ['type', 'level', 'content']) &&
      (value.level === 2 || value.level === 3) && validateInlineArray(value.content)
  }
  if (value.type === 'list') {
    return hasOnlyKeys(value, ['type', 'ordered', 'items']) &&
      typeof value.ordered === 'boolean' && Array.isArray(value.items) &&
      value.items.every(validateInlineArray)
  }
  return hasOnlyKeys(value, ['type', 'content']) && validateInlineArray(value.content)
}

export function validateArticleBlockDocument(value: unknown):
  | { ok: true; document: ArticleBlockDocument }
  | { ok: false; error: string } {
  if (!isRecord(value) || !hasOnlyKeys(value, ['version', 'blocks'])) {
    return { ok: false, error: '문서는 version과 blocks만 포함해야 합니다.' }
  }
  if (value.version !== 1 || !Array.isArray(value.blocks)) {
    return { ok: false, error: '지원하지 않는 block document 형식입니다.' }
  }
  if (!value.blocks.every(validateBlock)) {
    return { ok: false, error: '지원하지 않거나 잘못된 block이 있습니다.' }
  }
  return { ok: true, document: value as ArticleBlockDocument }
}

export function parseInlineMarkdown(text: string): ArticleInline[] {
  const result: ArticleInline[] = []
  const linkPattern = /\[([^\]]+)\]\(([^)\s]+)\)/g
  let cursor = 0
  for (const match of text.matchAll(linkPattern)) {
    const index = match.index ?? 0
    if (index > cursor) result.push({ type: 'text', text: text.slice(cursor, index) })
    if (isSafeArticleUrl(match[2])) {
      result.push({ type: 'link', text: match[1], href: match[2] })
    } else {
      result.push({ type: 'text', text: match[0] })
    }
    cursor = index + match[0].length
  }
  if (cursor < text.length) result.push({ type: 'text', text: text.slice(cursor) })
  return result.length > 0 ? result : [{ type: 'text', text }]
}

export function inlineToMarkdown(content: ArticleInline[]): string {
  return content.map((inline) => inline.type === 'link'
    ? `[${inline.text}](${inline.href})`
    : inline.text).join('')
}

export function importMarkdownDocument(markdown: string): ArticleBlockDocument {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ArticleContentBlock[] = []
  let paragraph: string[] = []

  const flushParagraph = () => {
    const text = paragraph.join('\n').trim()
    if (text) blocks.push({ type: 'paragraph', content: parseInlineMarkdown(text) })
    paragraph = []
  }

  for (let index = 0; index < lines.length;) {
    const line = lines[index]
    if (!line.trim()) {
      flushParagraph()
      index++
      continue
    }
    const image = line.trim().match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/)
    const attribution = line.trim().match(/^\*([^\n]*\[[^\]]+\]\([^)\s]+\)[^\n]*)\*$/)
    const heading = line.match(/^(#{2,3})\s+(.+)$/)
    const quote = line.match(/^>\s?(.*)$/)
    const list = line.match(/^\s*(?:(\d+)\.|[-*+])\s+(.+)$/)
    if (image || attribution || heading || quote || list) flushParagraph()

    if (image) {
      blocks.push(isSafeArticleUrl(image[2])
        ? { type: 'image', src: image[2], alt: image[1] }
        : { type: 'paragraph', content: [{ type: 'text', text: line }] })
      index++
    } else if (attribution) {
      blocks.push({ type: 'attribution', content: parseInlineMarkdown(attribution[1]) })
      index++
    } else if (heading) {
      blocks.push({
        type: 'heading', level: heading[1].length as 2 | 3,
        content: parseInlineMarkdown(heading[2]),
      })
      index++
    } else if (quote) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const match = lines[index].match(/^>\s?(.*)$/)
        if (!match) break
        quoteLines.push(match[1])
        index++
      }
      blocks.push({ type: 'blockquote', content: parseInlineMarkdown(quoteLines.join('\n')) })
    } else if (list) {
      const ordered = Boolean(list[1])
      const items: ArticleInline[][] = []
      while (index < lines.length) {
        const match = lines[index].match(/^\s*(?:(\d+)\.|[-*+])\s+(.+)$/)
        if (!match || Boolean(match[1]) !== ordered) break
        items.push(parseInlineMarkdown(match[2]))
        index++
      }
      blocks.push({ type: 'list', ordered, items })
    } else {
      paragraph.push(line.replace(/<[^>]+>/g, ''))
      index++
    }
  }
  flushParagraph()
  return { version: 1, blocks }
}

export function legacyContentToBlockDocument(content: string): ArticleBlockDocument {
  return importMarkdownDocument(content)
}

export function projectBlocksToContent(document: ArticleBlockDocument): string {
  return document.blocks.map((block) => {
    if (block.type === 'image') return `![${block.alt}](${block.src})`
    if (block.type === 'heading') return `${'#'.repeat(block.level)} ${inlineToMarkdown(block.content)}`
    if (block.type === 'blockquote') {
      return inlineToMarkdown(block.content).split('\n').map((line) => `> ${line}`).join('\n')
    }
    if (block.type === 'list') {
      return block.items.map((item, index) =>
        `${block.ordered ? `${index + 1}.` : '-'} ${inlineToMarkdown(item)}`).join('\n')
    }
    const text = inlineToMarkdown(block.content)
    return block.type === 'attribution' ? `*${text}*` : text
  }).join('\n\n')
}

export function blocksToPlainText(document: ArticleBlockDocument): string {
  return document.blocks.map((block) => {
    if (block.type === 'image') return block.alt
    if (block.type === 'list') return block.items.map(inlineToMarkdown)
      .join(' ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    return inlineToMarkdown(block.content).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  }).filter(Boolean).join('\n\n')
}
