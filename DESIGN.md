# EDM Star News — Design System

> 이 문서는 Codex/Claude가 코드 작성 시 일관된 디자인을 유지하기 위한 단일 진실원이다.
> UI 변경 시 이 문서를 먼저 확인하고, 원칙에서 벗어나는 결정은 이 문서에 기록한다.

---

## 1. 디자인 방향

**테마**: Bold Editorial — 전자음악 특유의 에너지를 담은 강렬한 잡지체.
mixmag 스타일에서 레이아웃 구조와 타이포그래피 강도를 참고하되, 시각적으로 차별화.

핵심 원칙:
- 타이포그래피가 디자인을 이끈다. 이미지보다 글자가 먼저 눈에 들어와야 한다.
- 밝은 배경(화이트/오프화이트). 다크 테마 없음.
- 색상은 절제한다. 액센트는 파란색 하나. 카테고리 레이블만 예외.
- 여백은 너그럽게. 좁으면 답답하다.
- 모든 컴포넌트는 모바일 우선(mobile-first)으로 작성한다.

---

## 2. 폰트 (Google Fonts)

```html
<!-- app/layout.tsx 의 <head>에 포함 -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;900&family=Noto+Sans+KR:wght@400;500;700;900&display=swap" rel="stylesheet" />
```

| 역할 | 폰트 | 용도 |
|---|---|---|
| Display | Barlow Condensed 700/900 | 로고, 섹션 라벨, 카테고리 배지, 영문 짧은 텍스트 |
| Body | Noto Sans KR 400/500/700/900 | 모든 한국어 텍스트, 기사 본문, UI 텍스트 |

CSS 변수:
```css
--font-display: 'Barlow Condensed', sans-serif;
--font-body: 'Noto Sans KR', sans-serif;
```

**규칙**:
- 기사 제목(h1, 카드 h2)은 `font-body`의 `font-black`(900) — 한국어 기사이므로
- 영문 라벨, 네비게이션, 배지 등 짧은 영문은 `font-display`
- 본문(`content`)은 `font-body` 400, line-height 1.9

---

## 3. 컬러 팔레트

```css
--color-bg:           #FFFFFF;
--color-bg-subtle:    #F7F7F7;
--color-border:       #E8E8E8;
--color-text:         #0A0A0A;
--color-text-muted:   #6B6B6B;
--color-accent:       #0052D4;      /* 메인 파란색 */
--color-accent-hover: #003FA3;

/* 카테고리 전용 */
--color-cat-festival: #F97316;      /* 오렌지 — 페스티벌 */
--color-cat-release:  #059669;      /* 에메랄드 — 릴리즈 */
--color-cat-news:     #0052D4;      /* 파란색 — 뉴스 */
```

카테고리 배지 Tailwind 클래스:
```ts
const CATEGORY_BADGE: Record<string, string> = {
  '페스티벌': 'bg-orange-500 text-white',
  '릴리즈':   'bg-emerald-600 text-white',
  '뉴스':     'bg-blue-600 text-white',
};
// fallback: 'bg-gray-800 text-white'
```

---

## 4. 타이포그래피 스케일

| 용도 | Tailwind 클래스 |
|---|---|
| 히어로 기사 제목 | `text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black leading-tight` |
| 카드 제목 (대) | `text-lg sm:text-xl font-bold leading-snug` |
| 카드 제목 (소, 사이드바) | `text-sm font-bold leading-snug` |
| 섹션 라벨 | `text-xs font-bold tracking-[0.2em] uppercase` (Barlow Condensed) |
| 본문 | `text-[17px] leading-[1.9] font-normal` |
| 날짜/메타 | `text-xs text-gray-500` |
| 네비 | `text-sm font-medium` |

---

## 5. 레이아웃 구조

### 컨테이너
```
max-w-[1280px] mx-auto px-4 md:px-6 lg:px-8
```

### 헤더
```
h-14 md:h-16
bg-white border-b border-gray-200
로고: "EDM STAR NEWS" — Barlow Condensed 900, uppercase, letter-spacing tight
네비 데스크톱: 가로 링크 목록
네비 모바일: overflow-x-auto 스크롤 탭 (스크롤바 숨김)
```

### 홈 페이지 (`app/page.tsx`)
```
[히어로] — 첫 번째 기사 전체 너비, 이미지 위 텍스트 오버레이
[본문]
  ├── 기사 카드 그리드 lg:col-span-8  (3열→2열→1열)
  └── 사이드바       lg:col-span-4  (인기 기사 리스트)
모바일: 사이드바가 그리드 아래에 위치
```

### 기사 상세 (`app/articles/[slug]/page.tsx`)
```
[헤더] — 카테고리 배지, 제목, 날짜
[대표 이미지] — 전체 너비, aspect-[2/1], object-cover
[본문] — max-w-[720px] mx-auto
[하단] — 카테고리 링크 / 홈 복귀
```

---

## 6. 컴포넌트 규칙

### 기사 카드 패턴
```tsx
<article className="group">
  <a href={`/articles/${slug}`}>
    {/* 이미지 */}
    <div className="relative aspect-[16/9] overflow-hidden bg-gray-100">
      <img className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
      {/* 카테고리 배지 — 좌상단 */}
      <span className="absolute top-2 left-2 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider bg-orange-500 text-white">
        페스티벌
      </span>
    </div>
    {/* 텍스트 */}
    <div className="pt-3">
      <h2 className="font-bold leading-snug group-hover:text-blue-600 transition-colors">제목</h2>
      <time className="text-xs text-gray-500 mt-1 block">날짜</time>
    </div>
  </a>
</article>
```

**카드 규칙**:
- `border`, `shadow`, `rounded` 없음 (플랫, 에디토리얼)
- 호버: 이미지 scale 1.05 + 제목 color → blue-600
- 이미지 없을 때: `bg-gray-900` + 카테고리명 중앙

### 카테고리 배지
- 배경색 카테고리별 지정 (위 팔레트 참조)
- `rounded` 없음 (사각형)
- `px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider`

### 섹션 헤더
```tsx
<div className="flex items-center gap-3 mb-6 border-b-2 border-black pb-2">
  <h2 style={{fontFamily: 'Barlow Condensed, sans-serif'}}
      className="text-sm font-bold tracking-[0.2em] uppercase">
    최신 기사
  </h2>
</div>
```

---

## 7. 이미지 처리

- 폴백: `bg-gray-100` 회색 배경
- 핫링크 차단 도메인(`static.ra.co` 등)은 `isUsableImageUrl()`로 제외 (`lib/articles.ts` 기존 로직)
- 기사 상세 대표 이미지: `aspect-[2/1]`, `object-cover`

---

## 8. 반응형 브레이크포인트

Tailwind 기본값 사용 (sm: 640, md: 768, lg: 1024, xl: 1280).

홈 그리드:
```
grid-cols-1 sm:grid-cols-2 lg:grid-cols-3
```
사이드바:
```
flex-col lg:flex-row gap-8 (메인+사이드바 컨테이너)
```

---

## 9. 애니메이션 / 인터랙션

허용:
- 이미지 hover scale: `transition-transform duration-300`
- 링크/제목 color: `transition-colors duration-150`

금지:
- 페이지 전환 애니메이션
- 자동 슬라이더/캐러셀
- 스크롤 트리거 인트로

---

## 10. 금지 사항

- 외부 UI 라이브러리 (shadcn, Radix, MUI 등)
- `rounded-xl`, `rounded-2xl` 이상의 큰 radius (카드, 배지는 사각형)
- `shadow-xl`, `shadow-2xl` 이상의 과도한 그림자
- Inter, Roboto, Arial 등 제네릭 폰트
- 다크 배경 계열 (공개 사이트)
- 보라색, 핑크, 그라데이션 배경