import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '소개 | FEEL THE DROP',
  description: 'FEEL THE DROP는 한국어권 EDM 저널리즘의 공백을 채우기 위해 만들어진 독립 미디어입니다.',
}

export default function AboutPage() {
  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight mb-10">
          FEEL THE DROP는
        </h1>

        <div className="text-base leading-relaxed text-zinc-800 space-y-6">
          <p>
            한국어권 EDM 저널리즘의 공백을 채우기 위해 만들어진 독립 미디어입니다.
          </p>

          <p>
            2016년, 월드디제이페스티벌(WDF) 현장에서 EDM 씬을 처음 마주했습니다.
            10년이 지난 2026년, 아비치의 다큐멘터리를 계기로 전자음악이 단순한 유흥이 아닌
            인류의 서사라는 것을 깨달았고, 한국어로 된 제대로 된 EDM 자료가 거의 없다는
            사실에 직면했습니다.
          </p>

          <p>그 결핍이 이 사이트를 만들었습니다.</p>

          <p>
            페스티벌 라인업, 아티스트 동향, 새로운 릴리즈까지.
            EDM을 진지하게 듣는 사람들을 위한 뉴스를 만들어갑니다.
          </p>
        </div>

        <dl className="mt-16 pt-8 border-t border-zinc-200 space-y-3 text-sm">
          <div className="flex gap-4">
            <dt className="w-28 shrink-0 text-zinc-500">운영 매체명</dt>
            <dd className="text-zinc-800">FEEL THE DROP</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-28 shrink-0 text-zinc-500">상호</dt>
            <dd className="text-zinc-800">디디 (대표: 곽준성)</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-28 shrink-0 text-zinc-500">사업자등록번호</dt>
            <dd className="text-zinc-800">536-56-00864</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-28 shrink-0 text-zinc-500">다루는 분야</dt>
            <dd className="text-zinc-800">EDM, 전자음악, 페스티벌, DJ/프로듀서, 릴리즈, 클럽 문화</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-28 shrink-0 text-zinc-500">발행인 · 편집인</dt>
            <dd className="text-zinc-800 font-medium">곽준성</dd>
          </div>
          <div className="flex gap-4">
            <dt className="w-28 shrink-0 text-zinc-500">문의</dt>
            <dd>
              <a
                href="mailto:gwakjoonsung@gmail.com"
                className="text-zinc-800 hover:underline"
              >
                gwakjoonsung@gmail.com
              </a>
            </dd>
          </div>
        </dl>
      </main>
    </div>
  )
}
