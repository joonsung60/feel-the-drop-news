import { EDITOR_NAME } from '@/lib/site'

export type Book = {
  slug: string
  title: string
  author: string
  publisher: string
  publishedAt: string
  isbn: string
  pages: number
  format: string
  priceKrw: number
  coverImage: string
  description: string[]
  toc: string[]
  purchaseLinks: { label: string; url: string }[]
  predecessorNote?: string
}

export const BOOKS: Book[] = [
  {
    slug: 'hidden-history-of-edm',
    title: '당신이 몰랐던 EDM의 역사',
    author: EDITOR_NAME,
    publisher: '유페이퍼',
    publishedAt: '2026-02-16',
    isbn: '9791176264594',
    pages: 176,
    format: 'PDF',
    priceKrw: 10000,
    coverImage: '/books/edm-history.jpg',
    description: [
      "한국어권에서 EDM은 오랫동안 '클럽 음악' 또는 '유흥의 배경음'으로만 소비되어 왔습니다. 왜 캘빈 해리스의 비트가 빌보드를 점령했는지, 왜 다프트 펑크는 헬멧을 써야 했는지, 왜 디트로이트의 버려진 건물이 테크노의 성지가 되었는지. 아무도 제대로 설명해주지 않았습니다.",
      "《당신이 몰랐던 EDM의 역사》는 그 정보의 빈곤을 끝내기 위해 쓰였습니다. 1979년 디스코 이후의 밤에서 시작해, 시카고 하우스와 디트로이트 테크노, 이비자와 레이브, 슈퍼스타 DJ의 시대를 거쳐 스트리밍과 15초의 시대까지. 45년의 전자음악사를 하나의 계보로 다시 세웁니다.",
      '페스티벌에서 드롭이 터질 때 왜 심장이 뛰는지 그 이유가 궁금한 리스너, 파편화된 검색 결과에 지친 디깅러, 그리고 대중문화와 자본과 기술이 만나는 지점을 들여다보고 싶은 독자를 위한 책입니다.',
    ],
    toc: ['머리말: 비트 너머의 세계를 위한 안내서', '1부: 기원과 문법', '2부: 유럽의 대중화 엔진', '3부: 글로벌 시장과 슈퍼스타 DJ', '4부: EDM 포맷의 완성', '5부: EDM 이후, 플랫폼과 로컬리티', '부록: 반드시 들어야 할 EDM 100선'],
    purchaseLinks: [{ label: '교보문고 eBook', url: 'https://ebook-product.kyobobook.co.kr/dig/epd/ebook/E000012616134' }],
    predecessorNote: "이 책은 FEEL THE DROP의 전신인 '디오스튜디오' 명의로 출간되었습니다.",
  },
]
