import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { BOOKS } from '@/lib/books'

export const metadata: Metadata = {
  title: '도서 | FEEL THE DROP',
  description: 'FEEL THE DROP이 펴낸 전자음악과 EDM에 관한 책입니다.',
}

export default function BooksPage() {
  return (
    <div className="max-w-[1280px] mx-auto px-4 md:px-6 lg:px-8 py-12 md:py-16">
      <h1 className="text-3xl font-black tracking-tight" style={{ fontFamily: 'var(--font-display), sans-serif' }}>BOOKS</h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-gray-700">FEEL THE DROP이 펴낸 책입니다. 사이트에 흩어진 기록을 한 권의 서사로 다시 엮습니다.</p>
      <div className="mt-12 grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-3">
        {BOOKS.map((book) => (
          <article key={book.slug}>
            <Link href={`/books/${book.slug}/`} className="block border border-gray-200 hover:border-gray-500 transition-colors">
              <Image src={book.coverImage} alt={`${book.title} 표지`} width={800} height={1136} className="h-auto w-full" />
            </Link>
            <p className="mt-4 text-xs text-gray-500">{book.publishedAt}</p>
            <h2 className="mt-1 text-xl font-bold"><Link href={`/books/${book.slug}/`} className="hover:underline">{book.title}</Link></h2>
            <Link href={`/books/${book.slug}/`} className="mt-3 inline-block text-sm font-bold text-[#0052D4] hover:underline">상세 보기 →</Link>
          </article>
        ))}
      </div>
    </div>
  )
}
