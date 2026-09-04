import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { BOOKS } from '@/lib/books'
import { SITE_URL } from '@/lib/site'

type PageProps = { params: Promise<{ slug: string }> }
const findBook = (slug: string) => BOOKS.find((book) => book.slug === slug)
export function generateStaticParams() { return BOOKS.map(({ slug }) => ({ slug })) }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const book = findBook((await params).slug)
  if (!book) return { title: '도서를 찾을 수 없습니다 | FEEL THE DROP' }
  const description = book.description[0]
  const url = `/books/${book.slug}/`
  return { title: `${book.title} | FEEL THE DROP`, description, alternates: { canonical: url }, openGraph: { title: book.title, description, url, images: [{ url: `${SITE_URL}${book.coverImage}` }] } }
}

export default async function BookDetailPage({ params }: PageProps) {
  const book = findBook((await params).slug)
  if (!book) notFound()
  return (
    <div className="max-w-[1000px] mx-auto px-4 md:px-6 py-12 md:py-16">
      <div className="grid grid-cols-1 gap-10 md:grid-cols-2 md:gap-14">
        <div className="border border-gray-200"><Image src={book.coverImage} alt={`${book.title} 표지`} width={800} height={1136} className="h-auto w-full" priority /></div>
        <div>
          <h1 className="text-3xl font-black leading-tight tracking-tight md:text-4xl">{book.title}</h1>
          <p className="mt-5 text-base text-gray-700">{book.author} · {book.publisher} · {book.publishedAt}</p>
          <dl className="mt-8 border-y border-gray-200 py-5 text-sm text-gray-700 space-y-2">
            <div className="flex justify-between gap-4"><dt>사양</dt><dd>{book.format}, {book.pages}쪽, ISBN {book.isbn}</dd></div>
            <div className="flex justify-between gap-4"><dt>정가</dt><dd>{book.priceKrw.toLocaleString('ko-KR')}원</dd></div>
          </dl>
          <div className="mt-8 flex flex-wrap gap-3">{book.purchaseLinks.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="bg-[#0052D4] px-5 py-3 text-sm font-bold text-white hover:bg-[#003fA6] transition-colors">{link.label} 구매</a>)}</div>
        </div>
      </div>
      <section className="mt-16 border-t border-gray-200 pt-10"><h2 className="text-sm font-bold tracking-[0.2em] uppercase" style={{ fontFamily: 'var(--font-display), sans-serif' }}>책 소개</h2><div className="mt-6 space-y-5 text-base leading-relaxed text-gray-800">{book.description.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}</div></section>
      <section className="mt-14 border-t border-gray-200 pt-10"><h2 className="text-sm font-bold tracking-[0.2em] uppercase" style={{ fontFamily: 'var(--font-display), sans-serif' }}>목차</h2><ol className="mt-6 space-y-2 text-base text-gray-800">{book.toc.map((item) => <li key={item}>{item}</li>)}</ol></section>
      {book.predecessorNote && <p className="mt-12 text-xs text-gray-500">{book.predecessorNote}</p>}
    </div>
  )
}
