import type { Metadata } from 'next'
import Link from 'next/link'
import { CONTACT_EMAIL, DEFAULT_OG_IMAGE_URL, SITE_URL, SOCIAL_LINKS } from '@/lib/site'
import CopyEmailButton from './CopyEmailButton'

const title = '보도문의 | FEEL THE DROP'
const description = 'FEEL THE DROP에 프레스킷, 보도자료, 신곡 및 공연·행사 소식을 보내주세요.'
const pressUrl = `${SITE_URL}/press/`
const focusStyle = 'focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-current'

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: pressUrl },
  openGraph: {
    title,
    description,
    url: pressUrl,
    siteName: 'FEEL THE DROP',
    locale: 'ko_KR',
    type: 'website',
    images: [{ url: DEFAULT_OG_IMAGE_URL }],
  },
}

const coverage = [
  '신곡 · 아티스트',
  '페스티벌 · 파티 · 레이브',
  '클럽 · DJ · 크루',
  '지역 축제 · 댄스 행사',
]

const materials = [
  '프레스킷 또는 보도자료',
  '발매·공연·행사 일정, 장소, 티켓 정보',
  '공식 홈페이지, 음원, 예매 및 SNS 링크',
  '고해상도 이미지·포스터·영상 또는 다운로드 링크',
  '이미지·영상 크레딧과 사용 가능 범위',
]

function PressContact() {
  return (
    <div className="min-w-0">
      <p className="select-text text-lg font-bold tracking-tight [overflow-wrap:anywhere] sm:text-2xl">
        {CONTACT_EMAIL}
      </p>
      <div className="mt-4">
        <CopyEmailButton />
      </div>
    </div>
  )
}

export default function PressPage() {
  return (
    <div className="bg-white text-[#0A0A0A]">
      <section aria-labelledby="press-title" className="bg-black text-white">
        <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-6 md:py-12 lg:px-8 lg:py-16">
          <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs font-bold tracking-widest">
            <span>보도문의</span>
            <span className="text-zinc-400" style={{ fontFamily: 'var(--font-display), sans-serif' }}>PRESS &amp; EDITORIAL</span>
          </p>
          <h1 id="press-title" className="mt-5 break-keep text-[clamp(1.75rem,4.4vw,3.75rem)] leading-[1.25] font-black tracking-tight md:mt-7">
            당신의 음악과 현장을<br />
            FEEL THE DROP에 알려주세요.
          </h1>
          <p className="mt-5 max-w-3xl break-keep text-sm leading-7 text-zinc-300 md:mt-7 md:text-base">
            FEEL THE DROP은 EDM을 중심으로 신곡과 아티스트, 페스티벌, 파티, 레이브, 클럽 문화, 지역 축제 등 함께 춤출 수 있는 음악과 그 주변의 이야기를 다루는 독립 음악 미디어입니다.
          </p>
          <div className="mt-6 grid gap-5 border-t border-white/30 pt-5 lg:mt-8 lg:grid-cols-2 lg:gap-12 lg:pt-7">
            <p className="max-w-xl break-keep text-sm leading-7 text-zinc-300 md:text-base">
              소개하고 싶은 소식이 있다면 프레스킷이나 보도자료를 보내주세요.
            </p>
            <PressContact />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1280px] px-4 md:px-6 lg:px-8">
        <section aria-labelledby="coverage-title" className="grid gap-5 border-b border-zinc-300 py-9 md:grid-cols-[1fr_2fr] md:gap-10 md:py-12">
          <h2 id="coverage-title" className="text-xl font-bold tracking-tight">다루는 소식</h2>
          <ul className="grid gap-x-8 gap-y-3 text-sm leading-relaxed sm:grid-cols-2 md:text-base">
            {coverage.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </section>

        <section aria-labelledby="materials-title" className="grid gap-6 border-b border-zinc-300 py-9 md:grid-cols-[1fr_2fr] md:gap-10 md:py-12">
          <div>
            <h2 id="materials-title" className="text-xl font-bold tracking-tight">보내주시면 좋은 자료</h2>
            <p className="mt-3 break-keep text-sm leading-6 text-zinc-600">준비된 자료부터 편하게 보내주세요.</p>
          </div>
          <div>
            <ul className="list-disc space-y-3 pl-5 text-sm leading-6 marker:text-zinc-400 md:text-base">
              {materials.map((item) => <li key={item} className="break-keep pl-1">{item}</li>)}
            </ul>
            <p className="mt-6 text-sm leading-6 text-zinc-600">공개 시점이나 엠바고가 있다면 함께 알려주세요.</p>
          </div>
        </section>

        <section aria-labelledby="example-title" className="border-b border-zinc-300 py-9 md:py-12">
          <h2 id="example-title" className="break-keep text-xl font-bold tracking-tight">프레스킷이 기사로 이어진 사례</h2>
          <article className="mt-6 border border-black p-6 md:mt-8 md:p-10">
            <p className="text-xs font-bold tracking-[0.2em] text-zinc-500" style={{ fontFamily: 'var(--font-display), sans-serif' }}>EDITORIAL EXAMPLE / 01</p>
            <div className="mt-5 grid items-end gap-6 md:grid-cols-2 md:gap-12">
              <h3 className="text-5xl leading-none font-black tracking-tight sm:text-6xl lg:text-7xl" style={{ fontFamily: 'var(--font-display), sans-serif' }}>
                TRICO<br />FESTIVAL 2026
              </h3>
              <div>
                <p className="max-w-lg break-keep text-sm leading-7 text-zinc-600 md:text-base">
                  주최 측이 제공한 프레스킷을 바탕으로, 행사의 기획 배경과 라인업, 공간의 특징을 소개했습니다.
                </p>
                <Link href="/articles/trico-2026/" className={`mt-5 inline-flex min-h-11 items-center text-sm font-bold underline underline-offset-4 transition-opacity hover:opacity-60 ${focusStyle}`}>
                  기사 읽기 →
                </Link>
              </div>
            </div>
          </article>
        </section>

        <section aria-labelledby="distribution-title" className="grid gap-7 py-9 md:py-12 lg:grid-cols-2 lg:gap-12">
          <div>
            <h2 id="distribution-title" className="break-keep text-2xl font-bold tracking-tight md:text-3xl">다음 소식도 함께 보내주세요.</h2>
            <p className="mt-4 max-w-xl break-keep text-sm leading-7 text-zinc-600 md:text-base">
              보도자료를 정기적으로 배포하신다면 FEEL THE DROP을 수신처에 포함해주세요.
            </p>
          </div>
          <div className="min-w-0">
            <PressContact />
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-zinc-600">
              {SOCIAL_LINKS.map((link) => (
                <a key={link.locale} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`FEEL THE DROP ${link.locale} 인스타그램 (새 탭)`} className={`inline-flex min-h-11 items-center underline underline-offset-4 hover:text-black ${focusStyle}`}>
                  Instagram {link.locale} ↗
                </a>
              ))}
            </div>
          </div>
        </section>

        <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-zinc-300 pt-5 text-xs text-zinc-600">
          <Link href="/editorial-policy/" className={`inline-flex min-h-11 items-center underline underline-offset-4 hover:text-black ${focusStyle}`}>편집·출처 정책</Link>
          <Link href="/corrections/" className={`inline-flex min-h-11 items-center underline underline-offset-4 hover:text-black ${focusStyle}`}>정정·제보</Link>
        </div>
      </div>
    </div>
  )
}
