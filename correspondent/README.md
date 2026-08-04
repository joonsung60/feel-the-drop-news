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

## Dance experience Phase 0

행사형 후보는 원문에서 확인된 춤 중심성, 독립 프로그램, 공개 접근, 날짜와
장소가 모두 있어야 `dance_experience/accepted`가 된다. 지역축제 안의 하위
댄스 프로그램은 해당 독립 슬롯에 연결된 정확한 시간 근거도 필요하며, 상위
축제 기간만으로 승인하지 않는다. 원문에 근거한 초대
전용 또는 부대 DJ 증거가 있으면 qualifying entity가 있어도 행사 승인을
우선 차단한다. 일반 아티스트 뉴스에는 이 행사형 차단을 적용하지 않는다.

행사 후보 식별키는 정규화된 제목, 현지 행사 날짜, 장소를 해시한다. NFKC와
case-fold를 적용하고 영숫자가 아닌 문자를 공백으로 바꾼 뒤 연속 공백을 접는다.
날짜나 장소가 없으면 각각 `missing-date`, `missing-venue`를 쓰고 정규화 URL을
추가해 불완전 후보를 source별로 안정적으로 구분한다. 일반 뉴스의 기존 URL
중복 처리는 변경하지 않는다.

현재 데이터 모델은 source 공식성이나 복수 source 간 일치 여부를 표현하지
않으며, 영속적인 수동 검토 큐도 없다. 따라서 이 기능들이 구현된 것으로
간주해서는 안 된다. `needs_verification`과 `rejected`는 observer 기록만 남기고
`raw_articles`에 insert하지 않는다. 오프라인 연구 데이터 검증은 저장소
루트에서 다음처럼 실행한다.

```bash
python3 research/korea-dance/validate.py
```
