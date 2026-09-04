import type { Metadata } from 'next'
import { EDITOR_NAME } from '@/lib/site'

export const metadata: Metadata = {
  title: '편집·출처 정책 | FEEL THE DROP',
}

export default function EditorialPolicyPage() {
  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight mb-8">편집·출처 정책</h1>
        <p className="text-sm text-zinc-500 mb-10">시행일: 2026년 6월 10일</p>

        <div className="text-base leading-relaxed text-zinc-800 space-y-8">
          <section>
            <p>
              FEEL THE DROP는 신뢰도 높은 한국어 EDM 정보를 제공하기 위해 아래와 같은 기준을 가지고 콘텐츠를 제작 및 편집합니다.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-3">1. 출처 및 정보 수집</h2>
            <p>
              본 사이트의 기사는 주로 해외 주요 EDM 및 전자음악 매체, 아티스트·레이블·페스티벌의 공식 SNS, 보도자료 등 확인 가능한 소스를 바탕으로 작성됩니다. 번역, 요약, 재구성된 콘텐츠는 독자가 원본을 확인할 수 있도록 가능한 한 원문 출처나 링크를 기사 내에 명확히 밝힙니다.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-3">2. 기술 및 AI의 보조적 활용</h2>
            <p>
              방대한 글로벌 소식을 신속하게 한국어로 전달하기 위해, 기사 초안 작성, 텍스트 번역 및 요약, 토픽 분류, 이미지 분석 과정에서 자동화 도구와 AI 모델을 보조적으로 활용할 수 있습니다. 그러나 모든 콘텐츠는 최종 게시 전 편집인 {EDITOR_NAME}의 검토와 승인을 거쳐 발행됩니다.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-3">3. 사실 확인 및 정정</h2>
            <p>
              단순 루머나 미확인 정보는 이미 공식적으로 확인된 사실과 명확히 구분하여 다루며, 독자에게 오해를 주지 않도록 주의합니다. 작성 과정의 한계로 인해 발생할 수 있는 정보의 오류는 독자의 정정 요청이나 자체 모니터링을 통해 신속하게 바로잡습니다.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-3">4. 저작권 보호 및 권리 존중</h2>
            <p>
              타인의 저작물(텍스트, 사진 등)을 인용할 때는 관련 법령이 허용하는 범위를 준수하기 위해 노력합니다. 만약 권리자의 허락 범위를 벗어나거나 저작권을 침해한 소지가 있다고 판단되는 경우, 저작권자의 요청이 접수되면 검토 후 지체 없이 해당 콘텐츠를 수정하거나 삭제합니다.
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
