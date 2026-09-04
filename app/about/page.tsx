import type { Metadata } from 'next'
import Link from 'next/link'
import { CONTACT_EMAIL, EDITOR_NAME, MAKER_NAMES, PUBLISHER_NAMES } from '@/lib/site'

export const metadata: Metadata = {
  title: '소개 | FEEL THE DROP',
  description: '한국어권 EDM 저널리즘의 공백을 채우기 위해 만들어진 독립 미디어입니다.',
}

export default function AboutPage() {
  return (
    <div className="min-h-full bg-zinc-50 text-zinc-900">
      <main className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-3xl font-bold tracking-tight mb-10">FEEL THE DROP는</h1>
        <div className="text-base leading-relaxed text-zinc-800 space-y-6">
          <p>한국어권 EDM 저널리즘의 공백을 채우기 위해 만들어진 독립 미디어입니다.</p>
          <p>2016년, 월드디제이페스티벌(WDF) 현장에서 EDM 씬을 처음 마주했습니다. 10년이 지난 2026년, 아비치의 다큐멘터리를 계기로 전자음악은 바로 인류의 서사라는 것을 깨달았으나, 한국어로 된 제대로 된 EDM 자료가 거의 없다는 사실에 직면했습니다.</p>
          <p>그 결핍이 이 사이트를 만들었습니다.</p>
          <p>FEEL THE DROP는 두 가지를 합니다. 하나는 뉴스입니다. 페스티벌 라인업, 아티스트 동향, 새로운 릴리즈를 매일 기록합니다. 다른 하나는 아카이브입니다. 흘러가는 뉴스를 시간이 지나도 찾아볼 수 있는 형태로 남깁니다. 기록되지 않은 씬은 없었던 것이 되기 때문입니다.</p>
          <p>시선은 한국에 두되, 아시아로 넓혀갑니다. 서구 미디어가 다루지 않는 한국과 일본의 전자음악 씬, 그리고 그 씬이 세계와 만나는 지점을 계속 찾아가겠습니다.</p>
        </div>
        <dl className="mt-16 pt-8 border-t border-zinc-200 space-y-3 text-sm">
          <div className="flex gap-4"><dt className="w-28 shrink-0 text-zinc-500">운영 매체명</dt><dd className="text-zinc-800">FEEL THE DROP</dd></div>
          <div className="flex gap-4"><dt className="w-28 shrink-0 text-zinc-500">다루는 분야</dt><dd className="text-zinc-800">EDM, 전자음악, 페스티벌, DJ/프로듀서, 릴리즈, 클럽 문화, 아시아 씬</dd></div>
          <div className="flex gap-4"><dt className="w-28 shrink-0 text-zinc-500">발행인</dt><dd className="text-zinc-800 font-medium">{PUBLISHER_NAMES}</dd></div>
          <div className="flex gap-4"><dt className="w-28 shrink-0 text-zinc-500">편집인</dt><dd className="text-zinc-800 font-medium">{EDITOR_NAME}</dd></div>
          <div className="flex gap-4"><dt className="w-28 shrink-0 text-zinc-500">만드는 사람들</dt><dd className="text-zinc-800 font-medium">{MAKER_NAMES}</dd></div>
          <div className="flex gap-4"><dt className="w-28 shrink-0 text-zinc-500">도서</dt><dd><Link href="/books/" className="text-zinc-800 hover:underline">/books/</Link></dd></div>
          <div className="flex gap-4"><dt className="w-28 shrink-0 text-zinc-500">문의</dt><dd><a href={`mailto:${CONTACT_EMAIL}`} className="text-zinc-800 hover:underline">{CONTACT_EMAIL}</a></dd></div>
        </dl>
      </main>
    </div>
  )
}
