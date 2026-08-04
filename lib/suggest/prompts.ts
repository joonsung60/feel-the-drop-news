export const SUGGEST_SYSTEM = `당신은 전세계 전자음악 씬 전반을 다루는 에디터입니다. 다국어(영어, 이탈리아어, 스페인어, 독일어, 프랑스어 등)로 된 뉴스 원문을 한 편 또는 여러 편 받아 언어에 무관하게 한국어 기사로 작성할 만한 소재인지 판단합니다.

핵심 원칙:
- 아래 주제 등 전자음악과 연결고리가 있으면 적극 승인하세요:
  * 아티스트/DJ/프로듀서 관련 소식
  * 릴리즈 (신곡, 앨범, EP, 리믹스)
  * 페스티벌, 클럽, 이벤트
  * 음악 장비, 신디사이저, 소프트웨어
  * 클럽 문화, 씬 소식, 업계 동향
  * 레이블, 스트리밍 플랫폼 관련 소식
- 거절 기준을 높이세요. 전자음악과 완전히 무관한 경우(예: 순수 팝/록 기사, 스포츠, 정치 등)에만 거절하세요.
- festival, fair, event, house, club, venue라는 단어 자체는 전자음악 근거가 아닙니다. house가 집을 뜻하는 문맥과 house music을 구분하세요.
- 라이프스타일 박람회, 홈·인테리어 행사, 브랜드·패션·푸드 전시, 무역 박람회, 일반 컨퍼런스는 명시적 전자음악 공연·아티스트·릴리즈 근거가 없으면 거절하세요.
- 범용 venue 이름만으로 승인하지 마세요. "HOME DIGGING FAIR at COEX THE PLATZ"는 거절해야 합니다.
- 거절 시 반드시 이유를 reason 필드에 넣으세요.
- 모든 소스를 동등하게 취급하세요. 특정 매체의 등급이나 권위를 기준으로 거르지 마세요.
- 연도 단독(2025, 2026 등), 매체명, 사이트명, 시리즈명, 인터뷰 형식 표현(catches up with, chats to, talks to 등), 연말 결산/차트/베스트 목록 문구는 절대 승인 기준으로 사용하지 마세요.
- "음악산업의 변화와 도전", "음악 페스티벌과 라이브 공연", "전자음악 씬 동향"처럼 여러 기사를 넓은 테마로 요약한 추상 토픽은 절대 만들지 마세요.
- topic에는 가능한 한 구체적 고유명사(아티스트명, 페스티벌명, 클럽명, 레이블명, 곡/앨범/EP명, 제품명, 책 제목 등)를 포함하세요.
- 좋은 예: "Music On Festival 취소 사태", "EDC Las Vegas 2026 관련 소식", "Armin van Buuren 'A State of Trance 2026' 발매", "John Summit 신곡 'Light Years' 공개"
- 나쁜 예: "음악산업의 변화와 도전", "음악 페스티벌과 라이브 공연", "전자음악 씬 동향", "클럽 문화의 변화"

응답 작성 시:
- topic은 한국어로, 구체적이고 명확하게 작성하세요.
- keywords는 3~6개의 영문 키워드로, 카테고리 단어 단독 사용 금지.
- 응답 JSON 스키마는 별도로 강제되므로 그 형식을 그대로 따르세요.`

export const SUGGEST_RESPONSE_FORMAT = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic: { type: 'string' },
          keywords: {
            type: 'array',
            items: { type: 'string' },
          },
          articleIds: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1,
            maxItems: 1,
          },
          reason: { type: 'string' },
          commonEntities: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['topic', 'keywords', 'articleIds', 'reason', 'commonEntities'],
      },
    },
  },
  required: ['suggestions'],
}

import { RawArticle } from './types'
import { articleSnippet } from './normalize'

export function buildClusterPrompt(batch: RawArticle[]): string {
  const articlesText = batch
    .map((article) =>
      [
        `[${article.id}]`,
        article.sourceName ? `매체: ${article.sourceName}` : null,
        `제목: ${article.title}`,
        `행사/발매일: ${article.event_date ?? '불명'}`,
        `본문: ${articleSnippet(article) || '(본문 없음)'}`,
      ].filter(Boolean).join('\n')
    )
    .join('\n---\n')

  return `다음 기사 목록(${batch.length}개)을 분석하세요.

기사별로 독립적인 suggestion을 만드세요.
하나의 suggestion에는 정확히 하나의 article ID만 넣으세요.
LLM 단계에서는 여러 기사를 서로 묶지 마세요. 동일 사건 기사 병합은 이후 deterministic 단계에서 수행됩니다.
후속 병합에서는 두 기사의 행사/발매일이 모두 알려져 있고 서로 다르면 병합하지 않습니다.
목록의 모든 기사를 끝까지 각각 검토한 뒤, 관련 기사마다 하나씩 suggestion을 만드세요.
관련 없는 기사는 suggestions 배열에서 생략하세요.
각 topic에는 해당 단일 기사의 구체적 고유명사나 작품명/행사명/제품명을 포함하세요.
festival, fair, event, house, club, venue라는 일반 단어 또는 범용 장소명만으로 승인하지 마세요.
홈·인테리어·라이프스타일·브랜드·패션·푸드 전시, 무역 박람회, 일반 컨퍼런스는 명시적 전자음악 근거가 없으면 거절하세요.
"HOME DIGGING FAIR at COEX THE PLATZ"는 거절 예시입니다. house가 집인지 house music인지 문맥으로 구분하세요.

기사 목록:
${articlesText}`
}

export function buildSingleGroupPrompt(batch: RawArticle[], entity: string): string {
  const articlesText = batch
    .map((article) =>
      [
        `[${article.id}]`,
        article.sourceName ? `매체: ${article.sourceName}` : null,
        `제목: ${article.title}`,
        `행사/발매일: ${article.event_date ?? '불명'}`,
        `본문: ${articleSnippet(article) || '(본문 없음)'}`,
      ].filter(Boolean).join('\n')
    )
    .join('\n---\n')

  return `다음은 엔터티 "${entity}"(으)로 묶인 기사 목록(${batch.length}개)입니다.
이 기사들이 모두 정확히 동일한 단일 사건을 다루고 있는지 확인하세요.
festival, fair, event, house, club, venue라는 단어 또는 범용 장소명만으로 전자음악 행사라고 판단하지 마세요.
홈·인테리어·라이프스타일·브랜드 전시는 명시적 전자음악 근거가 없으면 거절하세요.
"HOME DIGGING FAIR at COEX THE PLATZ"는 거절 예시이며 house와 house music을 구분해야 합니다.
두 기사의 행사/발매일이 모두 알려져 있고 서로 다르면 승인하지 마세요.
행사/발매일이 불명인 기사는 제목과 본문을 이용해 기존 방식으로 판단하세요.

기사 목록:
${articlesText}`
}
