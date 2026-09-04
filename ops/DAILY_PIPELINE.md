# 일일 기사 초안 파이프라인 운영

이 구성은 서버리스가 아니다. Next.js API, worker, Telegram bot은 WSL2의 systemd 서비스로 상시 실행하고, one-shot runner를 매일 한국 시간 15시에 timer로 시작한다. runner의 고정 실행 순서는 `pending Suggest 정리 → RSS 수집 → Suggest 1 → 초안 생성 → Telegram 알림`이다. 자동 생성 결과는 항상 비공개 초안이며 Telegram에서 사람이 선택해야 게시된다.

## 환경 변수

비밀값은 unit 파일에 쓰지 않고 프로젝트의 `.env.local`에서 읽는다. 파일 권한은 `chmod 600 .env.local`로 제한한다.

예제 unit의 `PATH`는 현재 설치된 fnm Node.js `v24.15.0` 경로를 사용한다. Node.js 버전을 바꾸면 `readlink -f "$(command -v node)"`로 실제 설치 경로를 확인해 네 unit의 `Environment=PATH=...`를 함께 갱신한다.

필수 값은 `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BOT_TOKEN`, `ALLOWED_USERS`, `ADMIN_PASSWORD`다. Ollama 관련 값은 기존 설정을 사용한다. `LOCAL_API=http://127.0.0.1:3001`, `AUTO_DRAFT_LIMIT=15`를 권장한다. 선택 값은 `DAILY_PIPELINE_HTTP_TIMEOUT_MS`, `DAILY_PIPELINE_JOB_TIMEOUT_MS`, `DAILY_PIPELINE_POLL_INTERVAL_MS`, `DAILY_PIPELINE_READINESS_TIMEOUT_MS`, `OLLAMA_GENERATE_TIMEOUT_MS`다. `OLLAMA_GENERATE_TIMEOUT_MS`의 기본값은 10분이며 Node 내장 fetch의 5분 제한을 사용하지 않는다. runner는 DB 실행을 만들기 전에 Next API와 Ollama가 준비될 때까지 제한된 시간 동안 기다린다. `CRON_SECRET`은 `/api/cron`을 외부에서 사용할 때만 설정하며 localhost one-shot runner에는 필요하지 않다.

## 설치와 시작

먼저 production Next.js 빌드를 만든다.

```bash
cd /home/joonsung/feel-the-drop-news
npm run build
sudo cp ops/systemd/feel-the-drop-*.service ops/systemd/feel-the-drop-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now feel-the-drop-api.service feel-the-drop-worker.service feel-the-drop-bot.service
sudo systemctl enable --now feel-the-drop-daily.timer
systemctl list-timers feel-the-drop-daily.timer
```

timer 표현 검증:

```bash
systemd-analyze calendar '*-*-* 15:00:00 Asia/Seoul'
systemd-analyze verify ops/systemd/feel-the-drop-daily.timer ops/systemd/feel-the-drop-daily.service
```

수동 one-shot은 중복 방지 제약을 그대로 사용한다. 같은 한국 날짜의 실행이 진행 중이거나 완료됐다면 새 실행이나 job을 만들지 않는다.

```bash
sudo systemctl start feel-the-drop-daily.service
journalctl -u feel-the-drop-daily.service -f
```

Windows 바탕화면 버튼도 테스트용 스크립트가 아니라 위와 동일한 unit을 비동기로 시작한다. 바로가기 대상은 `C:\Windows\System32\wsl.exe`, 인수는 다음과 같다.

```text
-d Ubuntu --user root --exec /usr/bin/systemctl start --no-block feel-the-drop-daily.service
```

따라서 수동 버튼과 15시 timer는 실행 주체만 다르고 실제 pipeline 진입점은 완전히 같다.

## 재시작과 상태 확인

```bash
sudo systemctl restart feel-the-drop-api feel-the-drop-worker feel-the-drop-bot
systemctl status feel-the-drop-api feel-the-drop-worker feel-the-drop-bot feel-the-drop-daily.timer
journalctl -u feel-the-drop-worker -u feel-the-drop-daily.service --since today
```

runner가 비정상 종료되면 lease 만료 후 같은 날짜의 수동 실행이 영속 상태에서 재개된다. worker의 `processing` job도 lease가 만료되면 다시 claim된다. suggestion별 unique job과 기존 cluster/article 재사용 로직이 재실행 중복 초안을 막는다.

정상적으로 `failed` 또는 `timed_out` 상태가 기록된 실행을 원인 해결 후 같은 날 재개하려면 명시적으로 retry 옵션을 사용한다. 이 옵션이 없으면 timer와 일반 수동 실행은 terminal 실행을 다시 열지 않는다.

```bash
cd /home/joonsung/feel-the-drop-news
worker/node_modules/.bin/tsx scripts/daily-pipeline.ts --retry-failed
```

자동 job idempotency는 일일 실행별 key에만 적용된다. Telegram에서 수동으로 등록한 실패 job은 같은 suggestion으로 다시 시도할 수 있다. 생성 결과는 suggestion 기반 `generation_key`로 보호되어 stale worker가 겹쳐 실행되더라도 초안은 하나만 저장된다.

## 검토 완료와 최종 배포

Daily 카드의 게시/삭제는 각 item을 각각 `published`/`deleted`로 기록한다. 생성에 실패한 `failed` item을 포함해 선택된 모든 item이 종료 상태가 된 마지막 요청만 DB RPC로 최종 Cloudflare 배포 권한을 claim한다. 이전 item 처리에서는 deploy hook을 호출하지 않으며, callback 재전송이나 동시 클릭은 같은 run의 claim을 다시 얻을 수 없다. 일반 수동 기사 게시의 기존 배포 동작은 이 경로와 분리되어 있다.

최종 배포 실패는 run의 `deploy_status=failed`와 `deploy_error`에 남고 Telegram으로 알린다. 원인을 해결한 뒤 해당 run만 명시적으로 재시도한다.

```text
/daily_status
/daily_deploy_retry RUN_ID
```

재시도 API는 `POST /api/daily-pipeline/[runId]/deploy`이며, 실패 상태 또는 15분 이상 stale한 claim만 다시 claim할 수 있다. 성공한 run이나 아직 검토가 끝나지 않은 run은 거부한다.

## Windows 재부팅 후 WSL 시작

Windows 작업 스케줄러에서 "컴퓨터 시작 시" 또는 "사용자 로그온 시" 작업을 만든다. 프로그램은 `C:\Windows\System32\wsl.exe`, 인수는 사용하는 배포판 이름에 맞춰 `-d Ubuntu --exec /bin/true`로 지정한다. "가능한 빨리 실행"과 필요 시 "가장 높은 권한으로 실행"을 선택한다. WSL의 `/etc/wsl.conf`에는 다음 설정이 필요하다.

```ini
[boot]
systemd=true
```

설정 변경 후 Windows 터미널에서 `wsl --shutdown`을 한 번 실행하고 WSL을 다시 시작한다. 앞에서 systemd unit을 enable했다면 WSL 시작 시 상시 서비스와 timer가 함께 복구된다.

## 전원과 절전 제약

PC가 꺼져 있거나 Windows가 절전·최대 절전 상태이면 WSL 프로세스, Ollama, systemd timer 모두 실행되지 않는다. `Persistent=true`는 WSL과 systemd가 다시 시작된 뒤 놓친 실행을 보충할 뿐, 꺼진 PC를 깨우지는 못한다. 정확히 15시에 실행해야 한다면 Windows 작업 스케줄러의 "작업을 실행하기 위해 컴퓨터 깨우기"와 전원 정책을 별도로 설정해야 한다. Ollama와 네트워크가 준비되지 않은 상태에서는 실행이 실패하며 Telegram 실패 알림을 시도한다.

## 안전한 검증

운영 migration 적용, 실제 Telegram 전송, 실제 publish는 별도 승인 후 수행한다. publish 검증 전에는 mock API 또는 사용자가 지정한 비공개 테스트 초안만 사용한다.
