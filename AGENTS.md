<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# AGENTS.md

이 문서는 코드 작성 에이전트(Claude Code, Codex, Gemini CLI 등)를 위한 최우선 지침서입니다.

---

## 원칙

- 작은 단위로 변경하라. 관련 파일을 먼저 읽고 확인한 뒤 수정하라.
- route 이름, DB 컬럼, 프롬프트 동작, 런타임 가정을 추측하지 마라.
- 불필요한 리팩토링, 의존성 변경, 포맷 수정은 하지 마라.

---

## 기술 스택

- Next.js 16.2.6 App Router (`--webpack` 강제, Turbopack 절대 금지)
- React 19.2.4, Tailwind CSS 4
- Supabase PostgreSQL + Storage
- Ollama (로컬 LLM, 모델은 환경변수로 제어)
- Cloudflare Pages static export

---

## 환경변수
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
OLLAMA_BASE_URL          # 기본: http://localhost:11434
OLLAMA_MODEL             # 기본: qwen3:14b
OLLAMA_SUGGEST_MODEL     # 토픽 제안 전용
OLLAMA_INTERVIEW_MODEL   # 인터뷰 번역 전용 (현재: mistral-small3.2:24b)
ADMIN_PASSWORD
CLOUDFLARE_DEPLOY_HOOK_URL
CRON_SECRET
SUPABASE_ACCESS_TOKEN    # Claude Code Supabase MCP용

비밀값을 절대 하드코딩하지 마라. 필수 환경변수가 없으면 명확한 에러를 던져라.

---

## 빌드 및 배포

### Cloudflare Stash Rule
`scripts/build-static.mjs`는 정적 빌드 시 `app/admin`, `app/api`, `proxy.ts`를 `.cf-build-stash`로 임시 이동한다. 빌드 중 이 파일들이 사라진 것처럼 보여도 절대 새로 생성하거나 삭제하지 마라. 이 스크립트를 임의로 리팩토링하지 마라.

### Next.js 16 특이사항
- `middleware.ts` 대신 `proxy.ts` 사용
- 동적 route handler의 `params`는 Promise
- 정적 export에서 API route 실행 불가

### Cloudflare 배포 훅
기사 게시/수정 시 `CLOUDFLARE_DEPLOY_HOOK_URL`로 재빌드가 트리거된다. 훅 발송 로직을 수정할 때는 반드시 디바운스를 적용하라. 디바운스 없이 연속 요청 시 월 500회 빌드 한도가 빠르게 소진된다.

---

## 파이프라인

이 프로젝트에는 여러 기사 생성 경로가 있다(RSS/URL 기반, 인터뷰 번역, 이미지/SNS 기반 등). 경로마다 구조가 다르므로 관련 route 파일을 먼저 읽고 파악하라.

**공통 원칙: 사람의 검토 없이 기사를 자동 게시하지 마라.**

---

## DB 데이터 시맨틱

- `articles.published = false` → 초안 (비공개)
- `articles.published = true` → 공개 게시
- `suggested_clusters.status = 'published'` → 제안이 기사 생성에 사용됨 (공개 게시 아님)
- 기사 초안 삭제 ≠ 원문 기사 거절

스키마 변경은 반드시 `supabase/migrations/`에 마이그레이션을 추가하고 관련 코드도 함께 수정하라. 컬럼 존재를 가정하지 마라.

---

## LLM / 프롬프트

- `lib/display-names.json` 기반 고유명사 매핑과 사후 치환(post-processing)은 핵심 방어막이다. 건드리지 마라. 단, `generate-from-cluster`는 `lib/edm-entities-v2.json`의 `established` 표기를 사용한다.
- `validateKoreanArticle` 검증 로직(한글 비율 30% 이상, 잡음 패턴 필터)과 1회 재시도 구조를 훼손하지 마라.
- 기사 생성 프롬프트, 출력 스키마, 분류 규칙은 명시적 요청 없이 수정하지 마라.
- Ollama 모델 선택은 환경변수로 제어한다. 하드코딩하지 마라.

### Ollama 타임아웃
로컬 LLM 호출은 수 분이 걸릴 수 있다. `AbortSignal.timeout()`을 적절히 설정하고, Next.js 기본 타임아웃(30초)을 넘는 작업은 스트리밍 또는 비동기 처리를 고려하라.

---

## 검증

변경 후 반드시 실행:

```bash
npx tsc --noEmit
npx eslint [수정한 파일]
```

가능하면:

```bash
npm run build
```

실행이 불가능한 경우 명확히 밝혀라.

---

## Git

명시적 요청 없이 `main`에 직접 커밋하지 마라.
변경 diff를 먼저 보여주고 확인을 받아라.
