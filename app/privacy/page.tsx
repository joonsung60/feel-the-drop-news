import type { Metadata } from 'next'
import { CONTACT_EMAIL } from '@/lib/site'

export const metadata: Metadata = { title: '개인정보처리방침 | FEEL THE DROP' }

export default function PrivacyPolicyPage() {
  return <div className="min-h-full bg-zinc-50 text-zinc-900"><main className="max-w-3xl mx-auto px-6 py-16">
    <h1 className="text-3xl font-bold tracking-tight mb-8">개인정보처리방침</h1><p className="text-sm text-zinc-500 mb-10">시행일: 2026년 6월 10일</p>
    <div className="text-base leading-relaxed text-zinc-800 space-y-8">
      <section><p>FEEL THE DROP(운영자 곽준성, 이하 &quot;본 사이트&quot;)는 이용자의 개인정보를 소중히 다루며, 관련 법령을 준수합니다. 본 사이트는 별도의 회원가입, 댓글, 결제 기능 등을 운영하지 않으므로 식별 가능한 개인정보를 원칙적으로 수집하지 않습니다.</p></section>
      <section><h2 className="text-xl font-bold mb-3">1. 수집하는 개인정보</h2><ul className="list-disc pl-5 space-y-2"><li><strong>이메일 문의 시:</strong> 이메일 주소, 이름, 문의 내용 등 사용자가 자발적으로 제공한 정보</li><li><strong>자동 수집 정보:</strong> 서비스 이용 과정에서 IP 주소, 쿠키, 방문 일시, 서비스 이용 기록, 불량 이용 기록, 기기 및 브라우저 정보 등이 자동으로 생성되어 수집될 수 있습니다.</li></ul></section>
      <section><h2 className="text-xl font-bold mb-3">2. 개인정보의 이용 목적</h2><p>수집된 정보는 다음 목적을 위해서만 이용됩니다.</p><ul className="list-disc pl-5 space-y-2 mt-2"><li>사용자의 문의, 정정, 제보에 대한 확인 및 회신</li><li>접속 빈도 파악, 서비스 이용 통계 분석(Google Analytics 등) 및 서비스 개선</li><li>보안 및 부정 이용 방지</li></ul></section>
      <section><h2 className="text-xl font-bold mb-3">3. 개인정보의 제3자 제공</h2><p>본 사이트는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다. 단, 법령의 규정에 의거하거나 수사 목적으로 법령에 정해진 절차와 방법에 따라 수사기관의 요구가 있는 경우는 예외로 합니다.</p></section>
      <section><h2 className="text-xl font-bold mb-3">4. 웹로그 분석 도구의 사용</h2><p>본 사이트는 Google Analytics와 같은 접속 통계 도구를 사용하여 이용자의 서비스 이용 형태를 분석할 수 있습니다. 이 과정에서 비식별 통계 정보가 처리되며, 사용자는 브라우저 설정을 통해 쿠키 저장을 거부할 수 있습니다.</p></section>
      <section><h2 className="text-xl font-bold mb-3">5. 개인정보 보호책임자 및 문의</h2><p>개인정보와 관련된 문의나 제공한 정보의 삭제 요청은 아래의 개인정보 보호책임자 및 운영자에게 연락해 주시기 바랍니다.</p><ul className="list-none mt-4 space-y-1"><li><strong>개인정보 보호책임자</strong></li><li>성명: 곽준성 (FEEL THE DROP 운영자)</li><li>이메일: <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-600 hover:underline">{CONTACT_EMAIL}</a></li></ul></section>
    </div>
  </main></div>
}
