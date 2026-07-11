import type { Metadata } from 'next'
import { CONTACT_EMAIL, PUBLISHER } from '@/lib/site'

export const metadata: Metadata = { title: '이용약관 | FEEL THE DROP' }

export default function TermsOfServicePage() {
  return <div className="min-h-full bg-zinc-50 text-zinc-900"><main className="max-w-3xl mx-auto px-6 py-16">
    <h1 className="text-3xl font-bold tracking-tight mb-8">이용약관</h1><p className="text-sm text-zinc-500 mb-10">시행일: 2026년 6월 10일</p>
    <div className="text-base leading-relaxed text-zinc-800 space-y-8">
      <section><p>FEEL THE DROP(이하 &quot;본 사이트&quot;)를 이용해 주셔서 감사합니다. 본 사이트의 서비스를 이용함에 있어 필요한 사항을 아래와 같이 안내합니다.</p></section>
      <section><h2 className="text-xl font-bold mb-3">1. 서비스의 목적 및 내용</h2><p>본 사이트는 EDM, 전자음악 및 관련 문화에 대한 뉴스, 정보, 아카이브를 제공하는 독립 미디어입니다. 음악, 공연, 릴리즈 등과 관련된 정보는 원 출처, 아티스트, 레이블, 주최 측의 사정이나 발표에 따라 사전 예고 없이 변경될 수 있습니다.</p></section>
      <section><h2 className="text-xl font-bold mb-3">2. 저작권 및 무단 복제 금지</h2><p>본 사이트가 자체적으로 작성한 기사, 요약문, 편집물 및 기타 콘텐츠에 대한 저작권은 본 사이트에 있습니다. 원칙적으로 콘텐츠의 무단 복제 및 전체 재배포를 금지합니다. 단, 출처(FEEL THE DROP)와 해당 기사의 링크를 명시하는 범위 내에서의 인용은 가능합니다.</p></section>
      <section><h2 className="text-xl font-bold mb-3">3. 외부 링크에 대한 책임 제한</h2><p>본 사이트는 다른 웹사이트나 자료에 대한 링크를 포함할 수 있습니다. 이는 이용자의 편의를 위한 것이며, 해당 외부 웹사이트의 내용이나 정책에 대해 본 사이트는 어떠한 통제권도 없고 이에 대한 책임을 지지 않습니다.</p></section>
      <section><h2 className="text-xl font-bold mb-3">4. 서비스 변경 및 중단</h2><p>본 사이트는 운영상의 필요에 따라 제공하는 서비스의 내용을 변경하거나 중단할 수 있습니다.</p></section>
      <section><h2 className="text-xl font-bold mb-3">5. 분쟁 해결 및 관할 법원</h2><p>본 사이트 이용과 관련하여 발생한 분쟁은 대한민국 법령을 적용하며, 법적 다툼이 발생할 경우 대한민국의 관할 법원 절차를 따릅니다.</p></section>
      <section><h2 className="text-xl font-bold mb-3">6. 운영자 정보</h2><ul className="list-none space-y-1"><li><strong>운영 매체명:</strong> FEEL THE DROP</li><li><strong>발행인·편집인:</strong> {PUBLISHER}</li><li><strong>문의:</strong> <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 hover:underline">{CONTACT_EMAIL}</a></li></ul></section>
    </div>
  </main></div>
}
