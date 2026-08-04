# Suggest pool selection audit — 2026-08-04

## 결론

현재 정책은 `published_at DESC` 단일 queue이며 DESC의 null-first 동작 때문에 발행일이 비어 있는 correspondent/backlog가 상단을 점유한다. 2026-08-04 RSS 123건 중 실제 suggest pool에 들어간 것은 3건뿐이었다. fetched_at 단독 정렬은 권장하지 않는다.

권장안은 **D cohort entitlement + fair remainder**다. limit의 70%를 최신 cohort에 보장하고 나머지를 RSS/correspondent/legacy, published-at 있음/없음, backlog queue에 weighted round-robin으로 배분한다. 최신 batch와 backlog 어느 쪽도 0이 되지 않는다. 운영상 긴급한 새 collect 전체 처리가 필요할 때만 B를 명시적 one-shot mode로 사용한다.

## Production 재현

- reference suggest: 2026-08-04T08:51:24.059Z
- 실제 pool: 100
- 2026-08-04 RSS batch 포함: 3 / 123
- 포함 rank: 17, 26, 48
- 밀린 기사: 120
- 주원인: published_at DESC is a single queue and PostgreSQL DESC places NULL first; null-published correspondent/backlog rows consumed 97 of 100 slots.

## 정책 비교

| Limit | Policy | 최신 batch | Relevant recall | Irrelevant | RSS/Corr | Sources | Null share | Backlog | Stale preview risk |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | A | 3 (0.0244) | 0.0139 | 2 | 14/10 | 2 | 1 | 97 | 2 |
| 100 | B | 100 (0.813) | 0.8056 | 36 | 100/0 | 31 | 0.04 | 0 | 0 |
| 100 | C | 40 (0.3252) | 0.375 | 12 | 58/26 | 33 | 0.37 | 60 | 6 |
| 100 | D | 70 (0.5691) | 0.6111 | 22 | 78/16 | 32 | 0.21 | 30 | 2 |
| 120 | A | 4 (0.0325) | 0.0139 | 3 | 27/18 | 2 | 1 | 116 | 4 |
| 120 | B | 120 (0.9756) | 0.9722 | 44 | 120/0 | 31 | 0.0333 | 0 | 0 |
| 120 | C | 48 (0.3902) | 0.4583 | 13 | 70/30 | 34 | 0.3583 | 72 | 8 |
| 120 | D | 84 (0.6829) | 0.7083 | 27 | 94/18 | 32 | 0.2083 | 36 | 4 |
| 200 | A | 80 (0.6504) | 0.6111 | 33 | 103/18 | 25 | 0.62 | 120 | 4 |
| 200 | B | 123 (1) | 1 | 45 | 183/1 | 51 | 0.025 | 77 | 0 |
| 200 | C | 84 (0.6829) | 0.7083 | 27 | 123/39 | 38 | 0.3 | 116 | 13 |
| 200 | D | 123 (1) | 1 | 45 | 147/31 | 34 | 0.225 | 77 | 8 |

Relevant recall과 irrelevant inclusion은 editorial ground truth가 있는 2026-08-04 exact 123건 안에서 계산했다. A/100은 실제 production log이며, 나머지는 같은 시점의 상태를 재구성한 시뮬레이션이다.

## 정책 정의

- A: production과 동일한 eligible-state + `published_at DESC` 단일 queue.
- B: 최신 acquisition cohort를 source round-robin으로 먼저 소비하고 남는 limit을 backlog로 채움.
- C: origin × cohort/backlog × published-null/dated queue를 만들고 가중치 4/3/1로 weighted round-robin. 각 queue 내부도 source round-robin.
- D: limit의 70%를 최신 cohort에 source-fair entitlement로 배정하고, 나머지 30%를 C의 fair backlog queue로 채움.

## Event date

`event_date < today`만으로 제외하지 않는다. 제목과 본문 500자에서 preview 신호와 post-event 신호를 나눠 stale preview 위험만 보고한다. death/cancellation/review/aftermovie 같은 후속 보도는 과거 event_date여도 유지한다. 현재 facts에는 correspondent gate와 일부 구조화 사실이 있지만 news lifecycle을 일관되게 표현하는 필드는 없어 텍스트 휴리스틱만으로 완전한 분리는 불가능하다.

## RSS와 correspondent

| Path | Collected | Published null | Event null | Content p50/p90 | Current top100 | Reached suggest | Never candidate | Article age p50/p90 h | First-suggest p50/p90 h | Sources | Max source share |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| RSS collect | 1133 | 0.0397 | 1 | 2655/9273 | 31 (0.0274) | 66 (0.0583) | 1067 | 157.25196083333333/283.0141830555556 | 0.11127722222222222/49.76603 | 40 | 0.0724 |
| Correspondent | 44 | 0.5227 | 0.2727 | 336/394 | 12 (0.2727) | 24 (0.5455) | 20 | 455.84084972222223/816.2630719444444 | 16.846275277777778/22.87755 | 1 | 1 |

- RSS: feed publication date를 `published_at`에 저장하고 원문 추출 content를 저장한다. `event_date`, `facts`, `doc_type`은 보통 비어 있다.
- Correspondent: LLM 정제 summary, grounded `event_date`, `doc_type`, facts와 gate metadata를 저장한다. HTML publication date가 없으면 `published_at=null`을 의도적으로 보존한다.
- 양쪽 모두 URL 중복 시 기존 row를 update/enrich하지 않는다. RSS는 사전 SELECT 후 skip, correspondent는 `on_conflict=url, resolution=ignore-duplicates`이다.

## 권장 pseudocode

```sql
-- Read-only snapshot input. Cohort membership is resolved from the acquisition-run
-- boundary in application code; fetched_at is a tie-breaker, not the sole policy.
SELECT id, title, content, url, source_id, origin, published_at, fetched_at,
       event_date, suggestion_state, facts
FROM raw_articles
WHERE suggestion_state IS NULL OR suggestion_state = 'new';
```

```ts
const eligible = queryRawArticlesAtSnapshot()
const queues = partition(eligible, [
  origin: ['rss', 'correspondent', 'legacy'],
  cohort: ['latest_run', 'backlog'],
  publication: ['dated', 'null'],
])
for (const queue of queues) queue.orderBy(sourceRoundRobinThenPublishedAndFetched())
const latest = sourceRoundRobin(queues.latestCohort).take(Math.ceil(limit * 0.7))
const remainder = weightedRoundRobin(queues.without(latestCohort), {
  rss_latest: 4,
  correspondent_latest: 3,
  rss_backlog: 1,
  correspondent_backlog: 1,
  legacy_backlog: 1,
}, limit - latest.length)
return [...latest, ...remainder]
```

정확한 article ID 목록은 JSON의 `policies.{A|B|C|D}.{100|120|200}.articleIds`에 있다.

## 예상 production diff

- `app/api/suggest-clusters/route.ts`: 단일 query를 cohort metadata 조회 + queue selector 호출로 교체.
- 신규 `lib/suggest/pool-selection.ts`: deterministic queue 구성, source fairness, limit 처리.
- tests: null published, mixed origin, cohort overflow, repeated-state, post-event 사례.
- migration: **불필요**. 기존 `origin`, `fetched_at`, `published_at`, state timestamp로 구현 가능하다. 장기적으로 정확한 run ID를 저장하려면 별도 migration을 후속 검토한다.

## 남은 위험과 rollback

- fetched_at gap 기반 cohort 추론은 동시/장시간 run에서 부정확할 수 있다.
- correspondent source name이 raw row에 없어 source-level fairness가 origin 수준으로 축약된다.
- selection 개선 후에도 RSS 본문 추출 실패, correspondent publication-date 부재, duplicate enrichment 부재는 남는다.
- rollback은 selector feature flag를 끄고 기존 단일 query로 복귀한다. DB migration이 없어 데이터 rollback은 필요 없다.
