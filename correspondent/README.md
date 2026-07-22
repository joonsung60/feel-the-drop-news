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

`.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`OLLAMA_BASE_URL`이 있어야 한다. Ollama에는 `gemma3:27b` 모델이 준비되어야 한다.

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
제외된다. index beat는 `config.json`의 `max_index_items`만큼 최신성/상세 URL
휴리스틱 상위 링크를 처리한다. 추적 파라미터 denylist도 같은 파일에서 관리한다.
