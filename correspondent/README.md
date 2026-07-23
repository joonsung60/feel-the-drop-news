# FEEL THE DROP correspondent crawler

독립 Python 프로세스다. Next.js 서버와 연결되지 않으며, active `beat_sources`를
읽고 엔티티 게이트를 통과한 영문 기사만 `raw_articles`에 insert한다.

## Setup (WSL)

```bash
python3 -m venv correspondent/.venv
correspondent/.venv/bin/pip install -r correspondent/requirements.txt
CRAWL4_AI_BASE_DIRECTORY="$PWD/correspondent" correspondent/.venv/bin/crawl4ai-setup
```

`crawl4ai-setup`이 WSL의 시스템 패키지 권한 때문에 브라우저 설치만 실패하면,
Chromium을 프로젝트 로컬 경로에 설치한다.

```bash
TMPDIR=/tmp PLAYWRIGHT_BROWSERS_PATH="$PWD/correspondent/.playwright" \
  correspondent/.venv/bin/python -m playwright install chromium
```

프로젝트 루트 `.env.local`에서 `NEXT_PUBLIC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `OLLAMA_BASE_URL`을 읽는다. 크롤러 모델 우선순위는
`--model` > `OLLAMA_CRAWLER_MODEL` > `gemma3:27b`이다.

## Run

안전장치로 `--dry-run`과 `--execute` 중 하나를 반드시 명시해야 한다.

```bash
correspondent/.venv/bin/python correspondent/crawler.py --dry-run
correspondent/.venv/bin/python correspondent/crawler.py --execute
```

특정 beat만 진단할 때는 정확한 이름을 반복 지정할 수 있다.

```bash
correspondent/.venv/bin/python correspondent/crawler.py --dry-run --beat "EDC Korea"
```

실행 로그와 JSON이 아닌 Ollama 원문은 `correspondent/logs/`에 기록되며 Git에서
제외된다. 각 URL은 평문 HTTP를 먼저 시도하고 본문이 부족할 때만 브라우저로
폴백한다. index beat는 링크 문맥의 날짜를 인식해 가까운 미래, 날짜 불명 순으로
`config.json`의 `max_index_items`만큼 처리하며 이벤트형 목록의 과거 항목은 제외한다.
날짜가 하나도 인식되지 않으면 기존 링크 순서를 유지한다. HTTP 본문 길이 임계값과
추적 파라미터 denylist도 같은 파일에서 관리한다.
