import { supabaseAdmin as supabase } from '@/lib/supabase-admin'
import { SYSTEM_PROMPT_A } from '@/lib/prompts'
import { findGenre } from '@/lib/taxonomy'

type ImageSourceRow = {
  id: string
  image_url: string
  source_memo: string | null
  source_date: string | null
  extracted_text: string | null
  generated_article_id: string | null
}

type GeneratedImageArticle = {
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
const BUCKET_NAME = 'image-sources'
const MAX_BASE64_LENGTH = 14_000_000

function parseImagePayload(imageBase64: string): {
  base64: string
  mimeTypeFromPayload: string | null
} {
  const dataUrlMatch = imageBase64.match(/^data:(image\/(?:jpeg|jpg|png));base64,(.+)$/i)
  if (dataUrlMatch) {
    return {
      base64: dataUrlMatch[2],
      mimeTypeFromPayload: dataUrlMatch[1].toLowerCase().replace('image/jpg', 'image/jpeg'),
    }
  }

  return {
    base64: imageBase64.replace(/\s+/g, ''),
    mimeTypeFromPayload: null,
  }
}

function extensionForMime(mimeType: string): string {
  return mimeType === 'image/png' ? 'png' : 'jpg'
}

async function uploadArticleImage(
  sourceId: string,
  imageBase64: string,
  rawMimeType: string | null
): Promise<{ imageUrl: string; imagePath: string }> {
  if (imageBase64.length > MAX_BASE64_LENGTH) {
    throw new Error('이미지 파일이 너무 큽니다.')
  }

  const { base64, mimeTypeFromPayload } = parseImagePayload(imageBase64)
  const mimeType = (mimeTypeFromPayload ?? rawMimeType ?? 'image/jpeg')
    .toLowerCase()
    .replace('image/jpg', 'image/jpeg')

  if (!['image/jpeg', 'image/png'].includes(mimeType)) {
    throw new Error('jpg/png 이미지만 지원합니다.')
  }

  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length === 0) {
    throw new Error('이미지 데이터를 읽지 못했습니다.')
  }

  const ext = extensionForMime(mimeType)
  const imagePath = `${new Date().getFullYear()}/${sourceId}/article-${Date.now()}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(imagePath, bytes, {
      contentType: mimeType,
      upsert: false,
    })

  if (uploadError) {
    throw new Error(`이미지 업로드 실패: ${uploadError.message}`)
  }

  const { data } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(imagePath)

  return { imageUrl: data.publicUrl, imagePath }
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
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
  const safeBase = base || `image-article-${Date.now().toString(36)}`
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

function parseGeneratedArticle(response: string): GeneratedImageArticle | null {
  const candidates = extractJsonCandidates(response)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<GeneratedImageArticle>
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
      // Try the next candidate or the legacy parser below.
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

function formatSourceDate(value: string | null): string {
  if (!value) return '없음'
  const date = new Date(`${value}T00:00:00+09:00`)
  if (Number.isNaN(date.getTime())) return '없음'
  return date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  })
}

function buildPrompt(source: ImageSourceRow): string {
  return `아래는 단일 이미지/SNS 소스를 Vision LLM으로 분석한 결과입니다.
이 이미지 하나만을 근거로 한국어 EDM 뉴스 기사 초안을 작성하세요.

중요:
- 분석 결과에 없는 사실을 추측하지 마세요.
- 정보가 부족하면 짧고 신중한 기사로 작성하세요.
- 소스 메모는 사용자의 맥락 보충 자료입니다. 단, 메모만으로 과장하지 마세요.
- 날짜가 필요하면 사용자 입력 날짜 또는 이미지 분석 결과에 명확히 있는 구체적 날짜만 사용하세요.
- '오늘', '어제', '최근', '며칠 전' 같은 상대적 날짜 표현은 금지입니다.
- 출력은 반드시 JSON 객체 하나만 허용됩니다.
- 마크다운 코드블록, 설명 문장, 주석, 목록, 머리말을 JSON 앞뒤에 붙이지 마세요.
- JSON 키는 "title", "content", "slug", "category", "genre" 다섯 개입니다.
- JSON 문자열 안의 줄바꿈은 \\n으로 이스케이프하세요.
- category는 "페스티벌", "릴리즈", "뉴스" 셋 중 하나만 사용하세요. 페스티벌/행사/공연/레지던시는 "페스티벌", 신곡/앨범/EP/믹스/리믹스/컴필레이션 발매는 "릴리즈", 그 외는 모두 "뉴스"입니다.
- genre는 category가 "릴리즈"일 때만 "house", "techno", "trance", "drum-and-bass", "dubstep", "ambient" 중 하나를 사용하세요. 이 목록 중 특정하기 어렵거나 category가 "페스티벌" 또는 "뉴스"이면 반드시 "edm"으로 두세요.

[소스 메모]
${source.source_memo ?? '없음'}

[사용자 입력 날짜]
${formatSourceDate(source.source_date)}

[이미지 분석 결과]
${source.extracted_text ?? ''}

응답 예:
{"title":"한국어 기사 제목","content":"한국어 기사 본문","slug":"english-keyword-slug","category":"뉴스","genre":"edm"}`
}

async function generateArticle(source: ImageSourceRow): Promise<GeneratedImageArticle> {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
  const ollamaModel = process.env.OLLAMA_MODEL || 'qwen3:14b'

  const res = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      system: SYSTEM_PROMPT_A,
      prompt: buildPrompt(source),
      format: 'json',
      options: { num_ctx: 32768, num_predict: 4096 },
      stream: false,
      think: false,
    }),
  })

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    throw new Error(`Ollama 오류: ${JSON.stringify(data).slice(0, 300)}`)
  }

  if (!data?.response || typeof data.response !== 'string') {
    throw new Error(`Ollama 응답 없음: ${JSON.stringify(data).slice(0, 300)}`)
  }

  const generated = parseGeneratedArticle(data.response)
  if (!generated) {
    throw new Error(
      `Ollama 응답을 기사 JSON으로 파싱하지 못했습니다. 응답 미리보기: ${data.response.slice(0, 500)}`
    )
  }

  return generated
}

export type ImageSourceGenerationOptions = {
  imageBase64?: string | null
  mimeType?: string | null
}

export type ImageSourceGenerationResult = {
  article: Record<string, unknown>
}

export async function generateFromImageSource(
  imageSourceId: string,
  options: ImageSourceGenerationOptions = {}
): Promise<ImageSourceGenerationResult> {
  if (!imageSourceId) {
    throw new Error('imageSourceId가 필요합니다.')
  }

  const { data: source, error: sourceError } = await supabase
    .from('image_sources')
    .select('id, image_url, source_memo, source_date, extracted_text, generated_article_id')
    .eq('id', imageSourceId)
    .maybeSingle()

  if (sourceError) {
    throw new Error(sourceError.message)
  }

  if (!source) {
    throw new Error('이미지 소스를 찾을 수 없습니다.')
  }

  const imageSource = source as ImageSourceRow

  if (!imageSource.extracted_text?.trim()) {
    throw new Error('이미지 분석 결과가 없습니다.')
  }

  if (imageSource.generated_article_id) {
    const { data: existingArticle, error: existingArticleError } = await supabase
      .from('articles')
      .select('id')
      .eq('id', imageSource.generated_article_id)
      .maybeSingle()

    if (existingArticleError) {
      throw new Error(existingArticleError.message)
    }

    if (existingArticle) {
      throw new Error('이미 기사 초안이 생성된 이미지 소스입니다.')
    }

    const { error: resetError } = await supabase
      .from('image_sources')
      .update({
        generated_article_id: null,
        status: 'analyzed',
      })
      .eq('id', imageSource.id)

    if (resetError) {
      throw new Error(resetError.message)
    }

    imageSource.generated_article_id = null
  }

  let articleImageUrl = imageSource.image_url

  if (options.imageBase64) {
    const uploaded = await uploadArticleImage(
      imageSource.id,
      options.imageBase64,
      normalizeOptionalText(options.mimeType)
    )
    articleImageUrl = uploaded.imageUrl
  }

  const generated = await generateArticle(imageSource)
  const slug = await ensureUniqueSlug(normalizeSlug(generated.slug))
  const category = normalizeCategory(generated.category)
  const genre = normalizeGenreForCategory(category, generated.genre)

  const { data: article, error: articleError } = await supabase
    .from('articles')
    .insert({
      title: generated.title,
      content: generated.content,
      cluster_id: null,
      published: false,
      slug,
      category,
      genre,
      image_url: articleImageUrl,
    })
    .select()
    .single()

  if (articleError) {
    throw articleError
  }

  const { error: updateError } = await supabase
    .from('image_sources')
    .update({
      generated_article_id: article.id,
      status: 'draft_created',
    })
    .eq('id', imageSource.id)

  if (updateError) {
    throw updateError
  }

  return { article }
}
