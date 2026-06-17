import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '정정·제보 | EDM Star News',
}

export default function CorrectionsPage() {
  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight mb-8">정정·제보</h1>
        <p className="text-sm text-zinc-500 mb-10">시행일: 2026년 6월 10일</p>

        <div className="text-base leading-relaxed text-zinc-800 space-y-8">
          <section>
            <p>
              EDM Star News는 정확하고 신뢰할 수 있는 정보를 제공하기 위해 최선을 다하고 있습니다. 기사 내용 중 수정이 필요하거나 중요한 제보가 있다면 언제든 알려주시기 바랍니다.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-3">정정 및 제보 대상</h2>
            <ul className="list-disc pl-5 space-y-2">
              <li>오탈자 및 문맥상 심각한 번역 오류</li>
              <li>발매일, 라인업, 행사 장소 등 사실과 다른 정보</li>
              <li>기사의 원 출처 누락 및 표기 오류</li>
              <li>저작권 등 권리 침해 우려가 있는 내용</li>
              <li>기타 EDM 씬과 관련된 의미 있는 소식 제보</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-3">접수 방법</h2>
            <p>
              정정 요청이나 제보 시, 원활한 확인을 위해 <strong>해당 기사 URL, 문제 내용, 그리고 참고할 수 있는 근거 자료(공식 발표 링크 등)</strong>를 함께 보내주시기 바랍니다.
            </p>
            <ul className="list-none mt-4">
              <li><strong>이메일:</strong> <a href="mailto:gwakjoonsung@gmail.com" className="text-blue-600 hover:underline">gwakjoonsung@gmail.com</a></li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold mb-3">처리 절차</h2>
            <p>
              접수된 내용은 내부 검토를 거쳐 사실 확인 후, 기사 본문 수정, 하단 주석 추가, 또는 별도의 후속 정정 기사 발행 등의 방식으로 반영됩니다. 명백한 권리 침해나 허위 정보로 확인될 경우 즉시 기사가 삭제될 수 있습니다.
            </p>
          </section>
        </div>
      </main>
    </div>
  )
}
