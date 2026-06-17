import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { SYSTEM_PROMPT_A, SYSTEM_PROMPT_B } from '@/lib/prompts'
import { findGenre } from '@/lib/taxonomy'
import displayNames from '@/lib/display-names.json'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API,
})

function collapseLineBreaksInsideQuotes(text: string): string {
  let result = text.replace(/“([^”]*)”/g, (_, inner) => {
    const fixed = inner.replace(/\n+/g, ' ').replace(/ {2,}/g, ' ').trim()
    return `“${fixed}”`
  })
  result = result.replace(/"([^"]*)"/g, (_, inner) => {
    const fixed = inner.replace(/\n+/g, ' ').replace(/ {2,}/g, ' ').trim()
    return `"${fixed}"`
  })
  return result
}

const ARTICLE_RESPONSE_FORMAT = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    content: { type: 'string' },
    slug: { type: 'string' },
    category: { type: 'string' },
    genre: { type: 'string' },
  },
  required: ['title', 'content', 'slug', 'category', 'genre'],
}

type TextSourceMode = 'article' | 'translate'

type TextSourceRow = {
  id: string
  raw_text: string
  source_memo: string | null
  source_url: string | null
  source_date: string | null
  generated_article_id: string | null
  status: string
  mode: TextSourceMode | null
}

type GeneratedArticle = {
  title: string
  content: string
  slug: string
  category: string
  genre: string
}

const ALLOWED_CATEGORIES = ['페스티벌', '릴리즈', '뉴스']
const DEFAULT_CATEGORY = '뉴스'
const DEFAULT_GENRE = 'edm'
const SLUG_MAX_LENGTH = 50

const displayNameRules = Object.entries(displayNames as Record<string, string>)
  .map(([en, ko]) => `- ${en} → ${ko}`)
  .join('\n')

const displayNameReplacements = Object.entries(displayNames as Record<string, string>)
  .filter(([en, ko]) => en !== ko)
  .sort((a, b) => b[0].length - a[0].length)

function applyDisplayNameMapping(text: string): string {
  let result = text
  for (const [en, ko] of displayNameReplacements) {
    result = result.replaceAll(en, ko)
  }
  return result
}

function normalizeSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '')
}

function normalizeCategory(raw: string): string {
  const trimmed = raw.trim()
  return ALLOWED_CATEGORIES.includes(trimmed) ? trimmed : DEFAULT_CATEGORY
}

function normalizeGenre(raw: string): string {
  return findGenre(raw)?.slug ?? DEFAULT_GENRE
}

function normalizeGenreForCategory(category: string, raw: string): string {
  if (category !== '릴리즈') return DEFAULT_GENRE
  return normalizeGenre(raw)
}

async function ensureUniqueSlug(base: string): Promise<string> {
  const safeBase = base || `article-${Date.now().toString(36)}`
  let candidate = safeBase
  for (let suffix = 2; suffix < 100; suffix++) {
    const { data } = await supabase
      .from('articles')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()
    if (!data) return candidate
    candidate = `${safeBase}-${suffix}`
  }
  return `${safeBase}-${Date.now().toString(36)}`
}

function extractJsonCandidates(response: string): string[] {
  const candidates: string[] = []
  const fenced = response.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(fenced[1].trim())

  const firstBrace = response.indexOf('{')
  const lastBrace = response.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(response.slice(firstBrace, lastBrace + 1).trim())
  }

  candidates.push(response.trim())
  return Array.from(new Set(candidates.filter(Boolean)))
}

function parseGeneratedArticle(response: string): GeneratedArticle | null {
  const candidates = extractJsonCandidates(response)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<GeneratedArticle>
      if (typeof parsed.title === 'string' && typeof parsed.content === 'string') {
        return {
          title: parsed.title.trim(),
          content: parsed.content.trim(),
          slug: typeof parsed.slug === 'string' ? parsed.slug.trim() : '',
          category: typeof parsed.category === 'string' ? parsed.category.trim() : '',
          genre: typeof parsed.genre === 'string' ? parsed.genre.trim() : '',
        }
      }
    } catch {
      // Try next
    }
  }

  const titleMatch = response.match(/(?:^|\n)\s*(?:제목|title)\s*[:：]\s*(.+)/i)
  const contentMatch = response.match(
    /(?:^|\n)\s*(?:본문|내용|content)\s*[:：]\s*([\s\S]+?)(?=\n\s*(?:슬러그|slug|카테고리|category|장르|genre)\s*[:：]|$)/i
  )

  if (titleMatch && contentMatch) {
    const slugMatch = response.match(/(?:^|\n)\s*(?:슬러그|slug)\s*[:：]\s*(.+)/i)
    const categoryMatch = response.match(/(?:^|\n)\s*(?:카테고리|category)\s*[:：]\s*(.+)/i)
    const genreMatch = response.match(/(?:^|\n)\s*(?:장르|genre)\s*[:：]\s*(.+)/i)

    return {
      title: titleMatch[1].trim(),
      content: contentMatch[1].trim(),
      slug: slugMatch?.[1].trim() ?? '',
      category: categoryMatch?.[1].trim() ?? '',
      genre: genreMatch?.[1].trim() ?? '',
    }
  }

  return null
}

function buildPrompt(source: TextSourceRow): string {
  let sourceDateStr = '없음'
  if (source.source_date) {
    const date = new Date(`${source.source_date}T00:00:00+09:00`)
    if (!Number.isNaN(date.getTime())) {
      sourceDateStr = date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Seoul',
      })
    }
  }

  return `아래는 사용자가 제공한 텍스트 소스(유튜브 트랜스크립트, 인터뷰 원문 등)입니다.
이 텍스트와 소스 메모를 바탕으로 한국어 EDM 기사를 작성하세요.

중요:
- 텍스트 원문의 내용을 충실히 반영하되, 한국어 EDM 기사체로 자연스럽게 재구성하세요.
- 정보가 부족하면 추측하지 마세요.
- 소스 메모는 사용자의 맥락 보충 자료입니다.
- 다음의 고유명사 표기 규칙을 따르세요:
${displayNameRules}
- 출력은 반드시 JSON 객체 하나만 허용됩니다. 마크다운 코드블록, 설명 문장 등을 붙이지 마세요.
- JSON 키는 "title", "content", "slug", "category", "genre" 다섯 개입니다.
- JSON 문자열 안의 줄바꿈은 \\n으로 이스케이프하세요.
- category는 "페스티벌", "릴리즈", "뉴스" 셋 중 하나만 사용하세요.
- genre는 category가 "릴리즈"일 때만 "house", "techno", "trance", "drum-and-bass", "dubstep", "ambient" 중 하나를 사용하세요. 그 외는 "edm"으로 두세요.

[소스 메모 (맥락)]
${source.source_memo ?? '없음'}

[관련 날짜]
${sourceDateStr}

[텍스트 원문 (트랜스크립트/인터뷰 등)]
${source.raw_text}

응답 예:
{"title":"한국어 기사 제목","content":"한국어 기사 본문","slug":"english-keyword-slug","category":"뉴스","genre":"edm"}`
}

async function generateArticle(source: TextSourceRow): Promise<GeneratedArticle> {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  const ollamaModel = process.env.OLLAMA_MODEL || 'qwen3:14b'
  let lastError = '생성 실패'
  let lastResponsePreview = ''

  for (let attempt = 1; attempt <= 2; attempt++) {
    const retryGuidance = attempt > 1
      ? `\n이전 응답은 검증에 실패했습니다. 실패 이유: ${lastError}\n이번에는 반드시 title, content, slug, category, genre 다섯 키를 모두 채운 JSON 객체 하나만 출력하세요.\n`
      : ''

    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        system: SYSTEM_PROMPT_A,
        prompt: buildPrompt(source) + retryGuidance,
        format: ARTICLE_RESPONSE_FORMAT,
        options: { num_ctx: 32768, num_predict: 16384 },
        stream: false,
        think: false,
      }),
    })

    const data = await res.json().catch(() => null)

    if (!res.ok) {
      lastError = `Ollama 오류: ${JSON.stringify(data).slice(0, 300)}`
      continue
    }

    if (!data?.response || typeof data.response !== 'string') {
      lastError = `Ollama 응답 없음: ${JSON.stringify(data).slice(0, 300)}`
      continue
    }

    lastResponsePreview = data.response.slice(0, 500)

    const generated = parseGeneratedArticle(data.response)
    if (!generated) {
      lastError = 'Ollama 응답을 기사 JSON으로 파싱하지 못했습니다.'
      continue
    }

    return generated
  }

  throw new Error(
    `${lastError}${lastResponsePreview ? ` 응답 미리보기: ${lastResponsePreview}` : ''}`
  )
}

type GeneratedTranslation = {
  title: string
  content: string
}

function buildTranslatePrompt(source: TextSourceRow): string {
  let sourceDateStr = '없음'
  if (source.source_date) {
    const date = new Date(`${source.source_date}T00:00:00+09:00`)
    if (!Number.isNaN(date.getTime())) {
      sourceDateStr = date.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Seoul',
      })
    }
  }

  return `다음 원문을 한국어로 충실히 번역하세요.

[displayNameRules]
${displayNameRules}

[소스 메모 (맥락)]
${source.source_memo ?? '없음'}

[관련 날짜]
${sourceDateStr}

[원문]
${source.raw_text}
`
}

async function generateTranslation(source: TextSourceRow): Promise<GeneratedTranslation> {
  const promptText = buildTranslatePrompt(source)

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: SYSTEM_PROMPT_B,
    messages: [{ role: 'user', content: promptText }],
  })

  const firstBlock = message.content[0]
  if (!firstBlock || firstBlock.type !== 'text') {
    throw new Error('Claude API 응답이 없습니다.')
  }

  let translatedContent = firstBlock.text.trim()
  if (!translatedContent) {
    throw new Error('Claude API 번역 내용이 비어 있습니다.')
  }

  console.log('[text-source/translate] 후처리 전 줄바꿈 패턴:',
    translatedContent.slice(0, 500).replace(/\n/g, '↵').replace(/\r/g, '↩'))

  translatedContent = collapseLineBreaksInsideQuotes(translatedContent)

  translatedContent = translatedContent
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(?<!\n)\n(?!\n)/g, '\n\n')

  translatedContent = translatedContent
    .replace(/\n{2,}/g, '§PARA§')
    .replace(/\n/g, ' ')
    .replace(/§PARA§/g, '\n\n')
    .trim()

  const contentLines = translatedContent.split('\n\n')
  let generatedTitle = ''
  if (contentLines.length > 1) {
    const firstChunk = contentLines[0].trim()
    if (firstChunk.length <= 150 && !firstChunk.startsWith('“') && !firstChunk.startsWith('"')) {
      generatedTitle = firstChunk.replace(/^[#*_\s]+|[#*_\s]+$/g, '').trim()
      translatedContent = contentLines.slice(1).join('\n\n').trim()
    }
  }

  const title = generatedTitle || '제목 없음'

  return { title, content: translatedContent }
}

export type TextSourceGenerationResult = {
  article: Record<string, unknown>
}

export async function generateFromTextSource(
  textSourceId: string
): Promise<TextSourceGenerationResult> {
  if (!textSourceId) {
    throw new Error('textSourceId가 필요합니다.')
  }

  const { data: source, error: sourceError } = await supabase
    .from('text_sources')
    .select('*')
    .eq('id', textSourceId)
    .maybeSingle()

  if (sourceError) {
    throw new Error(sourceError.message)
  }

  if (!source) {
    throw new Error('텍스트 소스를 찾을 수 없습니다.')
  }

  const textSource = source as TextSourceRow

  if (!textSource.raw_text?.trim()) {
    throw new Error('텍스트 원문이 없습니다.')
  }

  if (textSource.generated_article_id) {
    const { data: existingArticle, error: existingArticleError } = await supabase
      .from('articles')
      .select('id')
      .eq('id', textSource.generated_article_id)
      .maybeSingle()

    if (existingArticleError) {
      throw new Error(existingArticleError.message)
    }

    if (existingArticle) {
      throw new Error('이미 기사 초안이 생성된 텍스트 소스입니다.')
    }

    const { error: resetError } = await supabase
      .from('text_sources')
      .update({
        generated_article_id: null,
        status: 'pending',
      })
      .eq('id', textSource.id)

    if (resetError) {
      throw new Error(resetError.message)
    }

    textSource.generated_article_id = null
  }

  const mode: TextSourceMode = textSource.mode === 'translate' ? 'translate' : 'article'

  let title: string
  let content: string
  let slug: string
  let category: string
  let genre: string

  if (mode === 'translate') {
    const translated = await generateTranslation(textSource)
    title = applyDisplayNameMapping(translated.title)
    content = applyDisplayNameMapping(translated.content)
    if (textSource.source_url) {
      content += `\n\n*원문 참조: ${textSource.source_url}*`
    }
    slug = await ensureUniqueSlug(normalizeSlug(title))
    category = '인터뷰'
    genre = DEFAULT_GENRE
  } else {
    const generated = await generateArticle(textSource)
    title = applyDisplayNameMapping(generated.title)
    content = applyDisplayNameMapping(generated.content)
    if (textSource.source_url) {
      content += `\n\n*원문 참조: ${textSource.source_url}*`
    }
    slug = await ensureUniqueSlug(normalizeSlug(generated.slug))
    category = normalizeCategory(generated.category)
    genre = normalizeGenreForCategory(category, generated.genre)
  }

  const { data: article, error: articleError } = await supabase
    .from('articles')
    .insert({
      title,
      content,
      cluster_id: null,
      published: false,
      slug,
      category,
      genre,
    })
    .select()
    .single()

  if (articleError) {
    throw articleError
  }

  const { error: updateError } = await supabase
    .from('text_sources')
    .update({
      generated_article_id: article.id,
      status: 'generated',
    })
    .eq('id', textSource.id)

  if (updateError) {
    throw updateError
  }

  return { article }
}
