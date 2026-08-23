import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { cleanArticleText, extractArticleText } from '@/lib/article-extraction'
import entityDict from '@/lib/edm-entities-v2.json'
import entitySurfacePolicy from '@/lib/entity-surface-policy.json'
import {
  buildGroundingEvidence,
  getSourceDisplayNames,
  prepareGroundingSources,
  validateArticleGrounding,
} from '@/lib/article-grounding'
import {
  applyDisplayNameMappingToTitle,
  applyKoreanAvoidCorrections,
} from '@/lib/jobs/entity-display-name'
import { SYSTEM_PROMPT_A } from '@/lib/prompts'
import { findGenre } from '@/lib/taxonomy'

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

type SourceArticle = {
  title: string
  content: string
  source: string
  sourceName: string
  publishedAt: string | null
}

type GeneratedArticle = {
  title: string
  content: string
  slug: string
  category: string
  genre: string
}

const ALLOWED_CATEGORIES = ['페스티벌', '릴리즈', '뉴스']
const SLUG_MAX_LENGTH = 50
const DEFAULT_CATEGORY = '뉴스'
const DEFAULT_GENRE = 'edm'

type ClusterArticleRow = {
  raw_article_id: string
}

type RawArticleRow = {
  id: string
  title: string | null
  content: string | null
  url: string
  published_at: string | null
  source_id: string | number | null
}

type SourceMeta = {
  name: string
}

const RESPONSE_NOISE_PATTERNS = [
  /\b(login|search|members login|become a member|advertise|submit music|contact us)\b/i,
  /\b(share|email|facebook|twitter|reddit|pinterest|whatsapp|telegram)\b/i,
  /\b(previous article|next article|related articles|more from author|comments are closed)\b/i,
  /\b(sign up|subscribe|tags|just released|claim this offer|read more)\b/i,
]

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return '원문 매체'
  }
}

function cleanSourceUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.search = ''
    parsed.hash = ''
    return parsed.toString()
  } catch {
    return url
  }
}

function sourceNameForAttribution(article: RawArticleRow, sourceMeta: Map<string, SourceMeta>): string {
  if (article.source_id !== null) {
    const sourceName = sourceMeta.get(String(article.source_id))?.name?.trim()
    if (sourceName) {
      return sourceName
    }
  }

  return domainFromUrl(article.url)
}

function appendSingleSourceAttribution(
  content: string,
  rawArticles: RawArticleRow[],
  sourceMeta: Map<string, SourceMeta>
): string {
  if (rawArticles.length !== 1) {
    return content
  }

  const [article] = rawArticles
  const sourceName = sourceNameForAttribution(article, sourceMeta)
  const sourceUrl = cleanSourceUrl(article.url)
  return `${content.trim()}\n\n*이 기사는 ${sourceName}의 원문을 바탕으로 핵심 내용을 한국어로 재구성한 것입니다. [원문 보기](${sourceUrl})*`
}

async function fetchSourceMeta(sourceIds: Array<string | number | null>): Promise<Map<string, SourceMeta>> {
  const ids = Array.from(new Set(sourceIds.filter((id): id is string | number => id !== null)))
  const sourceMeta = new Map<string, SourceMeta>()

  if (ids.length === 0) {
    return sourceMeta
  }

  const { data } = await supabase
    .from('rss_sources')
    .select('id, name')
    .in('id', ids)

  for (const source of (data ?? []) as { id: string | number; name: string | null }[]) {
    sourceMeta.set(String(source.id), {
      name: source.name ?? '알 수 없는 소스',
    })
  }

  return sourceMeta
}

function formatSourceDate(iso: string | null): string | null {
  if (!iso) {
    return null
  }

  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  })
}

async function fetchArticleContent(url: string): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const html = await res.text()
    return extractArticleText(html, 3000)
  } catch {
    return ''
  }
}

function parseGeneratedArticle(response: string): GeneratedArticle | null {
  const cleaned = response
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Partial<GeneratedArticle>
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
      // Fall through to the legacy parser for imperfect model output.
    }
  }

  const titleMatch = cleaned.match(/^제목:\s*(.+)$/m)
  const contentMatch = cleaned.match(/^내용:\s*([\s\S]+?)(?=\n(?:슬러그|카테고리|장르):|$)/m)
  if (!titleMatch || !contentMatch) {
    return null
  }
  const slugMatch = cleaned.match(/^슬러그:\s*(.+)$/m)
  const categoryMatch = cleaned.match(/^카테고리:\s*(.+)$/m)
  const genreMatch = cleaned.match(/^장르:\s*(.+)$/m)

  return {
    title: titleMatch[1].trim(),
    content: contentMatch[1].trim(),
    slug: slugMatch?.[1].trim() ?? '',
    category: categoryMatch?.[1].trim() ?? '',
    genre: genreMatch?.[1].trim() ?? '',
  }
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

function normalizeGenre(raw: string): string | null {
  return findGenre(raw)?.slug ?? null
}

function normalizeGenreForCategory(category: string, raw: string): string {
  if (category !== '릴리즈') return DEFAULT_GENRE
  return normalizeGenre(raw) ?? DEFAULT_GENRE
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

function validateKoreanArticle(article: GeneratedArticle): string | null {
  const combined = `${article.title}\n${article.content}`
  const koreanChars = combined.match(/[가-힣]/g)?.length ?? 0
  const latinChars = combined.match(/[a-z]/gi)?.length ?? 0
  const letterCount = koreanChars + latinChars
  const koreanRatio = letterCount > 0 ? koreanChars / letterCount : 0

  if (article.title.length < 8 || article.content.length < 120) {
    return '생성된 기사 제목 또는 본문이 너무 짧습니다.'
  }

  if (koreanRatio < 0.3) {
    return `한국어 비율이 낮습니다. koreanRatio=${koreanRatio.toFixed(2)}`
  }

  const noisePattern = RESPONSE_NOISE_PATTERNS.find((pattern) => pattern.test(combined))
  if (noisePattern) {
    return `원문 페이지 잡음이 포함됐습니다. pattern=${noisePattern.source}`
  }

  return null
}

async function generateKoreanArticle(articles: SourceArticle[]): Promise<GeneratedArticle> {
  const preparedSources = prepareGroundingSources(articles.map((article) => ({
    title: cleanArticleText(article.title, 500),
    content: cleanArticleText(article.content, 2500, { preserveParagraphBreaks: true }),
  })))
  const sourceEvidence = buildGroundingEvidence(preparedSources)
  const sourceDisplayNames = getSourceDisplayNames(
    sourceEvidence,
    entityDict.entities,
    entitySurfacePolicy,
  )
  const displayNameRules = sourceDisplayNames.length > 0
    ? sourceDisplayNames.map(({ en, ko }) => `- ${en} → ${ko}`).join('\n')
    : '- 허용된 한국어 고유명사 표기 없음 — 원문 영어 표기를 유지'
  const articlesText = articles
    .map((article, index) => {
      const publishedAt = formatSourceDate(article.publishedAt)
      const prepared = preparedSources[index]
      return [
        `[소스 ${index + 1}]`,
        `매체: ${article.sourceName}`,
        publishedAt ? `발행일: ${publishedAt}` : null,
        `제목: ${prepared.title}`,
        `URL: ${article.source}`,
        `내용: ${prepared.content}`,
      ].filter(Boolean).join('\n')
    })
    .join('\n\n---\n\n')

  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  const ollamaModel = process.env.OLLAMA_GENERATE_MODEL || process.env.OLLAMA_MODEL || 'qwen3:14b'
  let lastError = '생성 실패'

  for (let attempt = 1; attempt <= 2; attempt++) {
    const retryGuidance = attempt > 1
      ? `\n이전 응답은 검증에 실패했습니다. 실패 이유: ${lastError}\n이번에는 영어 원문 문장과 사이트 메뉴 문구를 절대 포함하지 말고, 자연스러운 한국어 기사로 다시 작성하세요.\n`
      : ''

    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ollamaModel,
        system: SYSTEM_PROMPT_A,
        prompt: `아래 소스들을 참고해 한국어 뉴스 기사를 새로 작성하세요.

[displayNameRules]
아래 목록은 이번 요청에서 사용할 수 있는 고유명사 표기 허용 목록입니다.
- 오른쪽 값이 한국어인 항목만 한국어 표기를 사용할 수 있습니다.
- 제목에서는 허용된 한국어 표기만 사용하고 영문 병기를 하지 마세요.
- 본문에서는 허용된 한국어 표기가 있는 고유명사가 처음 등장할 때 한 번만 "한국어(영문)" 형태로 쓰고, 이후에는 한국어만 쓰세요.
- 목록에 없거나, 값이 영문과 같거나, 한국어 표기가 애매한 아티스트명·장소명·행사명은 영문 그대로 유지하세요.
- 모델 지식으로 새 한국어 표기나 음역을 만들지 마세요. 예: SOURCE_ARTIST, SOURCE_FESTIVAL은 목록에 한국어 값이 없으면 원문 그대로 써야 합니다.
${displayNameRules}

[출력 지시]
- 소스 내용을 그대로 복사하지 마세요.
- 영어 원문 문장, 사이트 메뉴, 태그, 공유 버튼, 관련 기사 목록은 출력하지 마세요.
- 모든 소스를 동등하게 참고하되, 어느 한 소스의 표현이나 판단을 검증 없이 확대하지 마세요.
- 출력은 반드시 JSON 객체 하나만 허용됩니다.
- JSON 키는 "title", "content", "slug", "category", "genre" 다섯 개입니다.
- category는 반드시 "페스티벌", "릴리즈", "뉴스" 셋 중 하나만 사용하세요.
- genre는 반드시 "house", "techno", "edm" 셋 중 하나만 사용하세요.
- 릴리즈 기사에서 house 또는 techno로 명확히 특정되는 경우에만 각각 "house", "techno"를 쓰고, 그 외 모든 경우는 "edm"으로 두세요.
- 본문 content에 마크다운 문법을 절대 사용하지 마세요. #, ##, **, *, -, 불릿 포인트, 번호 목록 등 일체 금지입니다.
- 날짜별 일정을 나열할 때도 불릿이나 헤더 없이 자연스러운 문장으로 이어 쓰세요.
- 곡명, 앨범명, EP명은 번역하지 말고 원문 그대로 작은따옴표로 표기하세요. 예: 'SOURCE_TRACK'. 절대 한국어로 번역하지 마세요.
- 원문이 인터뷰 형식(Q&A)인 경우 질문과 답변을 그대로 나열하지 말고 기사체로 재구성하세요. 아티스트의 발언은 간접 인용 형태로 처리하세요. 예: "SOURCE_ARTIST는 낯선 사람들과의 대화에서 공연의 영감을 얻는다고 밝혔다." 직접 인용이 필요한 경우에만 따옴표로 한 문장 이내로 처리하세요.
- 실제 사실(날짜, 장소, 아티스트명, 곡명 등)이 없는 문장은 쓰지 마세요. "이러한 라인업은 ~의 역할을 보여줍니다", "특별한 경험을 선사합니다" 같은 홍보성 마무리 문장은 금지입니다.
- content는 마크다운 문법 없이 순수 텍스트로 쓰되, 2~4개 단락으로 나누고 단락 사이는 빈 줄(\n\n)로 구분하세요.
- slug: 영문 소문자와 하이픈만 사용하고 30자 이내. 기사 핵심 키워드 기반. 예: "source-artist-new-album-2026"
${retryGuidance}

[소스 데이터]
${articlesText}

[JSON 출력 형식]
{"title":"한국어 기사 제목","content":"한국어 기사 본문","slug":"english-keyword-slug-2026","category":"릴리즈","genre":"house"}`,
        format: ARTICLE_RESPONSE_FORMAT,
        options: { num_ctx: 32768, num_predict: 4096 },
        stream: false,
        think: false,
      }),
    })

    const data = await res.json()
    console.log('Ollama 응답:', JSON.stringify(data).slice(0, 500))

    if (!data.response || typeof data.response !== 'string') {
      lastError = `Ollama 응답 없음: ${JSON.stringify(data).slice(0, 300)}`
      continue
    }

    const parsed = parseGeneratedArticle(data.response)
    if (!parsed) {
      lastError = 'Ollama 응답을 기사 JSON으로 파싱하지 못했습니다.'
      continue
    }
    const generated = {
      ...parsed,
      title: applyDisplayNameMappingToTitle(parsed.title, sourceDisplayNames),
      content: applyKoreanAvoidCorrections(parsed.content, sourceDisplayNames),
    }

    const validationError = validateKoreanArticle(generated)
    const grounding = validateArticleGrounding({
      sourceEvidence,
      title: generated.title,
      content: generated.content,
      entities: entityDict.entities,
      policy: entitySurfacePolicy,
    })
    if (!validationError && grounding.ok) {
      return generated
    }

    lastError = [validationError, ...grounding.issues.map((issue) => issue.message)]
      .filter(Boolean)
      .join(' ')
    console.warn(`기사 검증 실패 attempt=${attempt}:`, lastError)
  }

  throw new Error(lastError)
}

export type ClusterGenerationResult =
  | { success: true; clusterId: string; article: Record<string, unknown> }
  | { success: false; clusterId: string; error: string }

export async function generateFromCluster(
  clusterIds: string[],
  options: { generationKeyByCluster?: Record<string, string> } = {},
): Promise<ClusterGenerationResult[]> {
  if (!Array.isArray(clusterIds) || clusterIds.length === 0) {
    throw new Error('clusterIds가 필요합니다.')
  }

  const results: ClusterGenerationResult[] = []

  for (const clusterId of clusterIds) {
    try {
      const generationKey = options.generationKeyByCluster?.[clusterId] ?? null
      if (generationKey) {
        const { data: existing, error: existingError } = await supabase
          .from('articles')
          .select('*')
          .eq('generation_key', generationKey)
          .maybeSingle()
        if (existingError) throw existingError
        if (existing) {
          results.push({ success: true, clusterId, article: existing })
          continue
        }
      }

      const { data: clusterArticles, error: clusterError } = await supabase
        .from('cluster_articles')
        .select('raw_article_id')
        .eq('cluster_id', clusterId)

      if (clusterError) throw clusterError

      const rawArticleIds = ((clusterArticles ?? []) as ClusterArticleRow[])
        .map((clusterArticle) => clusterArticle.raw_article_id)

      if (rawArticleIds.length === 0) {
        throw new Error('클러스터에 연결된 원문 기사가 없습니다.')
      }

      const { data: rawArticles, error: rawError } = await supabase
        .from('raw_articles')
        .select('id, title, content, url, published_at, source_id')
        .in('id', rawArticleIds)

      if (rawError) throw rawError
      if (!rawArticles || rawArticles.length === 0) {
        throw new Error('원문 기사를 찾지 못했습니다.')
      }

      const typedRawArticles = rawArticles as RawArticleRow[]
      const sourceMeta = await fetchSourceMeta(typedRawArticles.map((article) => article.source_id))

      const articlesWithContent = await Promise.all(
        typedRawArticles.map(async (article) => {
          const content = article.content || await fetchArticleContent(article.url)
          const meta = article.source_id !== null ? sourceMeta.get(String(article.source_id)) : undefined
          return {
            title: article.title || '제목 없음',
            content: cleanArticleText(content, 3000),
            source: article.url,
            sourceName: meta?.name ?? '알 수 없는 소스',
            publishedAt: article.published_at,
          }
        })
      )
      const usableArticles = articlesWithContent.filter((article) => article.content.length >= 80)

      if (usableArticles.length === 0) {
        throw new Error('생성에 사용할 수 있는 원문 본문이 없습니다.')
      }

      const generated = await generateKoreanArticle(usableArticles)
      const slug = await ensureUniqueSlug(normalizeSlug(generated.slug))
      const category = normalizeCategory(generated.category)
      const genre = normalizeGenreForCategory(category, generated.genre)
      const content = appendSingleSourceAttribution(generated.content, typedRawArticles, sourceMeta)

      const { data, error } = await supabase
        .from('articles')
        .insert({
          title: generated.title,
          content,
          cluster_id: clusterId,
          generation_key: generationKey,
          published: false,
          slug,
          category,
          genre,
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505' && generationKey) {
          const { data: existing, error: existingError } = await supabase
            .from('articles')
            .select('*')
            .eq('generation_key', generationKey)
            .maybeSingle()
          if (existingError) throw existingError
          if (existing) {
            results.push({ success: true, clusterId, article: existing })
            continue
          }
        }
        throw error
      }

      results.push({ success: true, clusterId, article: data })
    } catch (err) {
      results.push({ success: false, clusterId, error: String(err) })
    }
  }

  return results
}
