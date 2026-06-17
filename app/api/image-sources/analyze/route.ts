import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin as supabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'

const BUCKET_NAME = 'image-sources'
const VISION_MODEL = process.env.OLLAMA_VISION_MODEL || process.env.OLLAMA_MODEL || 'mistral-small3.2:24b'
const MAX_BASE64_LENGTH = 14_000_000

type AnalyzeRequest = {
  imageBase64?: string
  fileName?: string
  mimeType?: string
  sourceMemo?: string
  sourceDate?: string
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  return trimmed
}

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

function createVisionPrompt(sourceMemo: string | null, sourceDate: string | null): string {
  return `이미지는 EDM/전자음악 뉴스 기사화를 검토하기 위한 단일 SNS 캡처 또는 포스터 소스입니다.

분석 대상은 게시물의 실제 콘텐츠입니다. 포스팅 이미지, 포스터 본문, 게시물 캡션 본문을 중심으로 기사 작성에 필요한 사실만 추출하세요.

분석에서 제외할 것:
- 스마트폰 상태바의 시간, 배터리, 통신사, 와이파이 표시
- 인스타그램 앱 UI 요소: 좋아요/댓글/공유 버튼, 좋아요 수, 댓글 수, 저장 버튼, 팔로우 버튼, 메뉴 아이콘
- 현재 재생 중인 음악 표시, "누가 좋아요를 눌렀습니다" 같은 활동 알림, 기기 알림, 화면 녹화/스크린샷 UI
- 게시물 콘텐츠와 무관한 추천/탐색/광고/내비게이션 문구
- 위 UI 요소는 캡션이나 기사 근거로 사용하지 마세요. 특히 재생 중인 음악 제목을 이벤트/아티스트 정보로 착각하지 마세요.

계정명과 실제 아티스트명을 반드시 구분하세요:
- 인스타그램 계정명/핸들(예: maup, @maup)은 작성자 또는 출처일 수 있지만, 곧바로 아티스트 실명으로 간주하지 마세요.
- 실제 아티스트명은 포스터 본문, 캡션 문장, 라인업 텍스트, 이벤트 제목에서 확인되는 표기를 우선 사용하세요. 예: 계정명이 "maup"이어도 이미지나 캡션에 "Mau P"라고 적혀 있으면 아티스트명은 "Mau P"입니다.
- 계정명과 아티스트명이 다를 수 있으면 "계정명"과 "실제 아티스트명 후보"를 분리해서 적고, 확실한 근거가 없으면 불명확하다고 표시하세요.

라인업 포스터 분석 규칙:
- 이미지가 라인업/페스티벌 포스터라면 보이는 아티스트명을 일부만 요약하지 말고 전부 추출하세요.
- 크기가 작거나 흐릿해도 읽을 수 있는 이름은 최대한 많이 적으세요. 확실하지 않은 이름은 "(불명확)" 표시를 붙이세요.
- 헤드라이너, 서브 라인업, 하단 작은 글씨 라인업을 구분할 수 있으면 구분해서 적으세요.
- "등", "외 다수"처럼 생략하지 마세요. 이미지에 보이는 이름을 가능한 한 모두 나열하세요.

표기 정규화 규칙:
- 이미지 디자인상 전부 대문자로 적힌 이름도 표준 표기로 변환하세요. 예: MARTIN GARRIX → Martin Garrix, CALVIN HARRIS → Calvin Harris, TOMORROWLAND → Tomorrowland.
- 단, 원래 대문자/특수문자를 쓰는 공식 표기는 유지하세요. 예: BICEP, KSHMR, DJ Holographic, ANOTR, FISHER처럼 확신 가능한 공식 표기는 자연스러운 원문 표기를 사용하세요.
- 확신이 없으면 임의로 한글 음역하지 말고 영문 원문을 보존하세요.

반드시 확인할 항목:
- 아티스트명, DJ명, 레이블명, 행사명, 공연명, 페스티벌명
- 날짜, 시간, 장소, 도시, 국가
- 라인업, 티켓/예매 정보, 발표/공개/발매 정보
- 포스팅 이미지 안의 문구, 캡션 본문, 계정명, 해시태그 중 기사 근거가 될 수 있는 내용
- 날짜, 장소, 도시, 국가 같은 구체 정보는 이미지에 보이는 텍스트를 정확히 읽어 적으세요.
- 이미지에서 확실하지 않은 내용은 추측하지 말고 "불명확"이라고 표시하세요. 날짜나 장소를 보정하거나 만들어내지 마세요.
- 이미지나 캡션에 연도가 명시되지 않았다면 연도를 절대 추측하지 마세요. 예: "MAY 24"만 보이면 "5월 24일" 또는 "연도 불명확"으로 적고, "2026년 5월 24일"처럼 현재 연도나 사용자 입력 날짜를 근거 없이 붙이지 마세요.
- 인스타그램 캡션에서 맨 앞에 볼드체로 표시된 계정명이 실제 게시자입니다. 캡션 본문의 @태그는 언급된 대상입니다.

응답 형식:
- 실제 아티스트/주체
- 계정명/출처
- 이벤트/공연/릴리즈 정보
- 날짜와 장소
- 캡션 및 포스터 핵심 문구
- 기사화 가능한 핵심 사실
- 제외한 UI 잡음이 있다면 간단히 언급
- 기사화 판단

사용자 소스 메모:
${sourceMemo ?? '없음'}

사용자 입력 날짜:
${sourceDate ?? '없음'}

응답은 한국어로 작성하되, 아티스트명/행사명/곡명/레이블명 등 영문 고유명사는 이미지에 보이는 원문을 유지하세요.
마지막에 "기사화 판단" 항목을 두고, 이 이미지 하나만으로 기사 초안을 만들 수 있는지 간단히 평가하세요.`
}

async function analyzeImage(base64: string, sourceMemo: string | null, sourceDate: string | null): Promise<string> {
  const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'

  const res = await fetch(`${ollamaUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: VISION_MODEL,
      prompt: createVisionPrompt(sourceMemo, sourceDate),
      images: [base64],
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

  return data.response.trim()
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as AnalyzeRequest
    const sourceMemo = normalizeOptionalText(body.sourceMemo)
    const sourceDate = normalizeDate(body.sourceDate)
    const rawMimeType = normalizeOptionalText(body.mimeType)

    if (!body.imageBase64 || typeof body.imageBase64 !== 'string') {
      return NextResponse.json({ error: 'imageBase64가 필요합니다.' }, { status: 400 })
    }

    if (body.imageBase64.length > MAX_BASE64_LENGTH) {
      return NextResponse.json({ error: '이미지 파일이 너무 큽니다.' }, { status: 400 })
    }

    const { base64, mimeTypeFromPayload } = parseImagePayload(body.imageBase64)
    const mimeType = (mimeTypeFromPayload ?? rawMimeType ?? 'image/jpeg')
      .toLowerCase()
      .replace('image/jpg', 'image/jpeg')

    if (!['image/jpeg', 'image/png'].includes(mimeType)) {
      return NextResponse.json({ error: 'jpg/png 이미지만 지원합니다.' }, { status: 400 })
    }

    const bytes = Buffer.from(base64, 'base64')
    if (bytes.length === 0) {
      return NextResponse.json({ error: '이미지 데이터를 읽지 못했습니다.' }, { status: 400 })
    }

    const id = crypto.randomUUID()
    const now = new Date()
    const year = now.getFullYear()
    const ext = extensionForMime(mimeType)
    const imagePath = `${year}/${id}/original.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(imagePath, bytes, {
        contentType: mimeType,
        upsert: false,
      })

    if (uploadError) {
      return NextResponse.json(
        { error: `이미지 업로드 실패: ${uploadError.message}` },
        { status: 500 }
      )
    }

    const { data: publicUrlData } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(imagePath)

    const imageUrl = publicUrlData.publicUrl
    const extractedText = await analyzeImage(base64, sourceMemo, sourceDate)

    const { data: imageSource, error: insertError } = await supabase
      .from('image_sources')
      .insert({
        id,
        image_url: imageUrl,
        image_path: imagePath,
        source_memo: sourceMemo,
        source_date: sourceDate,
        extracted_text: extractedText,
        status: 'analyzed',
      })
      .select()
      .single()

    if (insertError) {
      return NextResponse.json(
        { error: `이미지 소스 저장 실패: ${insertError.message}` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      imageSource,
      extractedText,
      imageUrl,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
