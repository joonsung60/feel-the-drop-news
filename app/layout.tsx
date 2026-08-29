import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import Script from "next/script";
import { Barlow_Condensed, Noto_Sans_KR } from "next/font/google";
import { CONTACT_EMAIL, DEFAULT_OG_IMAGE_URL, PUBLISHER, RSS_ALTERNATE, SITE_URL, SOCIAL_LINKS } from "@/lib/site";
import { JsonLd } from "@/components/JsonLd";
import { ORGANIZATION_JSON_LD, WEBSITE_JSON_LD } from "@/lib/seo";
import { CATEGORY_NAV, RELEASE_GENRE_NAV } from "@/lib/taxonomy";
import "./globals.css";

const GA_MEASUREMENT_ID = "G-BY0W2KDPZ1";

const barlowCondensed = Barlow_Condensed({
  weight: ["700", "900"],
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const notoSansKR = Noto_Sans_KR({
  weight: ["400", "500", "700", "900"],
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "FEEL THE DROP",
  description: "한국어 EDM 뉴스 종합",
  alternates: {
    types: { 'application/rss+xml': RSS_ALTERNATE },
  },
  verification: {
    google: "dBSG9LfIn9zB1n1Hu13rgD_RqKS5GeEknVNf9a2PlMg",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
    },
  },
  icons: {
    icon: "/icon.png",
    apple: "/apple-icon.png",
  },
  openGraph: {
    title: "FEEL THE DROP",
    description: "한국어 EDM 뉴스 종합",
    url: SITE_URL,
    siteName: "FEEL THE DROP",
    locale: "ko_KR",
    images: [{ url: DEFAULT_OG_IMAGE_URL }],
  },
};

const NAV_ITEMS = [
  { label: "홈", href: "/" },
  { label: "특집", href: "/features/" },
  ...CATEGORY_NAV.map((item) => ({
    label: item.label,
    href: `/category/${item.slug}`,
  })),
  { label: "도서", href: "/books" },
];

const showAdminLink = process.env.BUILD_STATIC !== "1";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${barlowCondensed.variable} ${notoSansKR.variable} h-full antialiased`}
    >
      <body
        className="min-h-full flex flex-col bg-white text-[#0A0A0A]"
        style={{ fontFamily: "var(--font-body), sans-serif" }}
      >
        <JsonLd data={ORGANIZATION_JSON_LD} />
        <JsonLd data={WEBSITE_JSON_LD} />
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', '${GA_MEASUREMENT_ID}');
          `}
        </Script>

        {/* ── 헤더 ── */}
        <header className="border-b border-gray-200 bg-white sticky top-0 z-50">
          <div className="max-w-[1280px] mx-auto px-4 md:px-6 lg:px-8">
            {/* 상단 바 — 로고 + 슬로건 + 우측 액션 */}
            <div className="flex items-center justify-between gap-4 py-3 md:py-4">
              <div className="min-w-0">
                <Link
                  href="/"
                  className="block transition-opacity hover:opacity-80"
                  aria-label="FEEL THE DROP home"
                >
                  <Image
                    src="/logo.png"
                    alt="FEEL THE DROP"
                    width={2508}
                    height={627}
                    priority
                    className="h-8 w-auto md:h-10"
                  />
                </Link>
                <p className="mt-1 text-xs font-medium text-gray-500">
                  EDM의 순간을 기록합니다
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/search"
                  aria-label="검색"
                  title="검색"
                  className="flex h-8 w-8 items-center justify-center border border-gray-200 text-gray-500 transition-colors hover:border-gray-400 hover:text-black"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                </Link>
                {showAdminLink && (
                  <Link
                    href="/admin"
                    className="text-[11px] font-bold uppercase tracking-widest text-gray-400 hover:text-black transition-colors border border-gray-200 hover:border-gray-400 px-2.5 py-1"
                    style={{ fontFamily: "var(--font-display), sans-serif" }}
                  >
                    Admin
                  </Link>
                )}
              </div>
            </div>

            {/* 하단 바 — 카테고리 네비 */}
            <nav className="relative flex items-center border-t border-gray-100 -mx-4 px-4 md:mx-0 md:px-0 md:border-t-0">
              <div className="flex min-w-0 flex-1 items-center">
                {NAV_ITEMS.map((item) => (
                  item.href === "/category/release" ? (
                    <details key={item.label} className="group relative shrink-0">
                      <summary className="genre-nav-summary list-none cursor-pointer px-3 py-2.5 text-sm font-medium text-gray-600 hover:text-black whitespace-nowrap border-b-2 border-transparent group-open:border-black transition-colors">
                        릴리즈 ▾
                      </summary>
                      <div className="absolute left-0 top-full z-20 min-w-40 border border-gray-200 bg-white py-1.5 shadow-lg">
                        {RELEASE_GENRE_NAV.map((genre) => (
                          <Link
                            key={genre.slug}
                            href={`/genre/${genre.slug}/`}
                            className="block px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-black transition-colors"
                          >
                            {genre.label}
                          </Link>
                        ))}
                      </div>
                    </details>
                  ) : (
                    <Link
                      key={item.label}
                      href={item.href}
                      className="shrink-0 px-3 py-2.5 text-sm font-medium text-gray-600 hover:text-black whitespace-nowrap border-b-2 border-transparent hover:border-black transition-colors"
                    >
                      {item.label}
                    </Link>
                  )
                ))}
              </div>
            </nav>
          </div>
        </header>

        {/* ── 메인 ── */}
        <main className="flex-1">{children}</main>

        {/* ── 푸터 ── */}
        <footer className="border-t border-gray-200 bg-[#F7F7F7] mt-16 text-[#0A0A0A]">
          <div className="max-w-[1280px] mx-auto px-4 md:px-6 lg:px-8 py-10 md:py-12">
            <div className="grid grid-cols-1 gap-10 md:grid-cols-3 md:gap-12">
              <div className="max-w-xs">
                <Image src="/logo.png" alt="FEEL THE DROP" width={2508} height={627} className="h-7 w-auto" />
                <p className="mt-3 text-sm text-gray-600 leading-relaxed">한국어 EDM 뉴스와 전자음악 아카이브를 위한 독립 미디어</p>
                <div className="mt-5 flex gap-4 text-sm font-medium text-gray-700">
                  {SOCIAL_LINKS.map((link) => <a key={link.locale} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`FEEL THE DROP ${link.locale === 'KR' ? '한국어' : '일본어'} 인스타그램`} className="inline-flex items-center gap-1.5 hover:text-black transition-colors"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg>{link.locale}</a>)}
                </div>
              </div>
              <div><h2 className="text-xs font-bold tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-display), sans-serif" }}>섹션</h2><div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-3 text-sm font-medium text-gray-700"><Link href="/features/" className="hover:text-black transition-colors">특집</Link>{CATEGORY_NAV.map((item) => <Link key={item.slug} href={`/category/${item.slug}`} className="hover:text-black transition-colors">{item.label}</Link>)}{RELEASE_GENRE_NAV.map((item) => <Link key={item.slug} href={`/genre/${item.slug}`} className="hover:text-black transition-colors">{item.label}</Link>)}<Link href="/archive/" className="hover:text-black transition-colors">전체 기사</Link><Link href="/books" className="hover:text-black transition-colors">도서</Link><Link href="/feed.xml" className="hover:text-black transition-colors">RSS</Link></div></div>
              <div><h2 className="text-xs font-bold tracking-[0.2em] uppercase" style={{ fontFamily: "var(--font-display), sans-serif" }}>정보</h2><div className="mt-4 flex flex-col gap-3 text-sm font-medium text-gray-700"><Link href="/about" className="hover:text-black transition-colors">소개</Link><Link href="/editorial-policy" className="hover:text-black transition-colors">편집·출처 정책</Link><Link href="/corrections" className="hover:text-black transition-colors">정정·제보</Link><Link href="/privacy" className="hover:text-black transition-colors">개인정보처리방침</Link><Link href="/terms" className="hover:text-black transition-colors">이용약관</Link><a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-black transition-colors">문의</a></div></div>
            </div>
            <div className="mt-10 pt-6 border-t border-gray-200 flex flex-col md:flex-row justify-between gap-6 text-xs text-gray-500"><p>© 2026 FEEL THE DROP. All rights reserved.</p><p>발행인·편집인 {PUBLISHER}</p></div>
          </div>
        </footer>
      </body>
    </html>
  );
}
