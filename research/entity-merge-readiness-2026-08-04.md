# Entity addendum merge-readiness — 2026-08-04

## 결론

Production merge는 실행하지 않았다. 2026-08-04 batch와 과거 RSS collect 3개 batch, 총 401건에 production matcher/eligibility를 그대로 적용했다.

- Addendum으로 새로 생긴 false positive: **0건**
- 2026-08-04에서 false negative: 20 → 12
- 과거 3개 batch에서는 addendum surface가 eligible 결과를 바꾸지 않음
- 전체 RSS 저장분 surface sweep에서도 addendum 8개 entity의 관측 match는 모두 EDM/electronic 관련 기사
- Ozora는 **B안(contextual standalone alias)** 권장
- 8개 addendum entity는 모두 `accept` 권장하되 Ozora entry는 B안 policy와 함께 적용
- `Tiestö`는 단일 매체의 단일 오기만 확인되어 alias 추가 `reject`

승인 전까지 `lib/edm-entities-v2.json`, `lib/entity-surface-policy.json`, production code는 변경하지 않는다.

## 회귀 대상

| Batch | UTC range | Rows |
|---|---|---:|
| 2026-08-04 | 08:46:35–08:49:30 | 123 |
| 2026-08-03 | 09:30:00.93733–09:32:04.888539 | 61 |
| 2026-08-01 | 10:57:37.890933–10:59:47.344501 | 89 |
| 2026-07-31 | 09:55:06.476512–09:57:43.636157 | 128 |

과거 batch는 `origin='rss'`이고 10분 이상 간격으로 분리된 collect 묶음 중 최신 3개를 사용했다. 모든 batch row count를 DB SELECT 결과와 다시 대조했다.

Editorial ground truth는 source 이름만으로 판정하지 않고 각 제목과 최대 800자 저장 excerpt를 검토했다. 과거 278건 중 relevant 204건, irrelevant 53건, ambiguous 21건이다. 기존 2026-08-04 audit은 relevant 72건, irrelevant 45건, ambiguous 6건이다.

## 회귀 검증표

`base → base+8 entity addendum` 순서다.

| Batch | Qualifying | Eligible | TP | FP | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2026-08-04 base | 39 | 59 | 52 | 6 | 20 | 89.66% | 72.22% |
| 2026-08-04 addendum | 48 | 67 | 60 | 6 | 12 | 90.91% | 83.33% |
| 2026-08-03 base | 20 | 36 | 31 | 2 | 10 | 93.94% | 75.61% |
| 2026-08-03 addendum | 20 | 36 | 31 | 2 | 10 | 93.94% | 75.61% |
| 2026-08-01 base | 34 | 49 | 45 | 2 | 22 | 95.74% | 67.16% |
| 2026-08-01 addendum | 34 | 49 | 45 | 2 | 22 | 95.74% | 67.16% |
| 2026-07-31 base | 42 | 67 | 62 | 2 | 34 | 96.88% | 64.58% |
| 2026-07-31 addendum | 42 | 67 | 62 | 2 | 34 | 96.88% | 64.58% |
| **합계 base** | **135** | **211** | **190** | **12** | **86** | **94.06%** | **68.84%** |
| **합계 addendum** | **144** | **219** | **198** | **12** | **78** | **94.29%** | **71.74%** |

과거 3개 batch에서 addendum 관련 match가 없었다는 것은 오탐 증가가 없었다는 근거이지만, 반복 recall 개선 근거는 아니다. 이를 보완하기 위해 전체 RSS 저장분에서 모든 addendum en/alias와 지정 surface raw 후보를 전수 조회했다.

## 새 false positive 전체 목록

**없음.**

401건 회귀에서 addendum으로 새로 eligible이 된 8건은 모두 `editorially_relevant`였고 모두 2026-08-04 batch에 있었다. 전체 RSS sweep에서 addendum entity가 실제 production boundary를 통과한 기사도 모두 관련 기사였다.

전체 RSS에서 확인한 addendum match:

| Entity | Matched articles | Assessment |
|---|---:|---|
| Christian Hornbostel | 1 | relevant |
| Eliza Rose | 1 | relevant |
| Moojo | 1 | relevant |
| Nick Warren | 1 | relevant |
| Hernán Cattáneo | 2 | relevant; 2026-07-30 Chinois lineup 기사 재등장 |
| Deadcrow | 1 | relevant |
| Giom | 1 | relevant |
| O.Z.O.R.A. Festival | 3 | relevant |

## 지정 surface 전수 확인

전체 RSS 저장분에서 문자열 후보 158건을 SELECT한 뒤 production matcher를 적용했다.

### Ozora

- Raw candidate: 3
- A actual match: 3
- B actual match: 3
- False positive: 0
- 세 기사 모두 Ozora Festival 사망/중단 관련 psytrance festival 기사

### Giom

- Raw candidate: 2
- Actual match: 1
- False positive: 0
- `#MyRecordBag – Giom’s 2000s house classics`만 match
- `coorganizado` 내부의 `giom` substring은 production boundary가 차단

### Better

- Raw candidate: 105
- Actual production match: 10
- 확정 false positive: 1
- 오탐: `Remembering Andrew Chow, the legendary turntablist who shaped Singapore’s hip-hop nightlife`
- 나머지 9건은 electronic production, DJ track selection, club/electronic artist 기사

`Better`는 기존 dictionary surface이며 addendum 때문에 생긴 문제는 아니다. 일반 비교급이므로 기존 false-positive risk가 높다.

### ADVANCED

- Raw candidate: 15
- Actual production match: 1
- 확정 false positive: 1
- 오탐: `Aventon Current ADV Review: An Amazing eMTB That Hits The Sweet Spot (Part 1)`

기존 `ADVANCED` surface가 `advanced skillsets`에서 match했다.

### Bandcamp

- Raw candidate: 30
- Actual production match: 14
- 확정 false positive: 9
- ambiguous: 1 (`Hourloupe, “Last Lost Word”`)

확정 오탐:

1. `“Kingdom Come, Kingdom Go” Brings Aging Church Organs Back to Life`
2. `Curió Curió, “Curió Curió”`
3. `Essential Releases, July 24, 2026`
4. `The Black Drumset, “Friends In Dark Places”`
5. `Nu Jazz, “Un Jazz”`
6. `Sir Richard Bishop, “Hillbilly Erotica”`
7. `Saxophonist Nora Stanley Goes Solo with “Glass”`
8. `Essential Releases, July 31, 2026`
9. `The Best Punk on Bandcamp, July 2026`

`Bandcamp` publication/platform 이름 자체가 qualifying entity인 현재 구조는 broad false-positive blocker다.

## Ozora A/B 비교와 권장안

### A. Standalone strong alias

```json
{
  "en": "O.Z.O.R.A. Festival",
  "aliases_en": ["Ozora Festival", "Ozora"]
}
```

### B. Festival phrase strong + standalone contextual

Dictionary entry에는 동일 surface를 두되 policy가 standalone `Ozora`를 strong surface에서 제거하고 festival 문맥에서만 허용한다.

```json
{
  "O.Z.O.R.A. Festival": {
    "contextual_surfaces": {
      "Ozora": {
        "before": ["festival", "psytrance", "psychedelic trance"],
        "after": ["festival", "psytrance", "psychedelic trance"],
        "max_gap_chars": 12
      }
    }
  }
}
```

두 안은 관측 3건에서 qualifying/eligible/TP/FP가 완전히 같았다. B는 다음을 모두 살렸다.

- `Ozora Festival`
- `Psytrance-Festival ... Ozora Festival`
- `Psychedelic Music Festival OZORA`

단독 지명 `Ozora`가 향후 헝가리 마을·비음악 문맥에 등장할 가능성을 고려하면, 관측 recall 손실 없이 collision surface를 제한하는 **B안 권장**이다.

## Tiestö 평가

- 전체 RSS raw occurrence: 1
- Base `Tiësto` match: 0
- 기사: `Review: Tiestö at Silverworks Island`
- 동일 본문 안에서도 `Tiestö` 오기가 반복됨
- 다른 source나 날짜에서 재현되지 않음
- 공식 표기 또는 정당한 대체 표기 근거 없음

판정: **reject**. 단일 publication typo를 global alias로 승격하지 않는다.

## Addendum별 판정

| Entity | Decision | Reason |
|---|---|---|
| Christian Hornbostel | accept | Multiword exact surface, 1 relevant hit, 0 FP, 공식 장기 dance 경력 |
| Eliza Rose | accept | Multiword exact surface, 1 relevant hit, 0 FP, 독립 electronic/house 근거 |
| Moojo | accept | Boundary-safe coined surface, 1 relevant hit, 0 FP, Afro-house 근거 |
| Nick Warren | accept | Multiword exact surface, 1 relevant hit, 0 FP, 장기 progressive-house 경력 |
| Hernán Cattáneo | accept | Accent/ascii surfaces 모두 안전, 2 relevant hits, 과거 batch 외 재등장 |
| Deadcrow | accept | Boundary-safe coined surface, 1 relevant hit, 0 FP, electronic label 근거 |
| Giom | accept | 1 relevant hit, `coorganizado` collision은 boundary 차단, 0 FP |
| O.Z.O.R.A. Festival | accept with B | 3 relevant hits, 0 FP; standalone `Ozora`는 contextual로 제한 |

## Metadata counts 검증

숫자를 하드코딩하지 않고 base/addendum 전체 `entities` 배열에서 다시 계산했다.

| Type | Base actual | Addendum | Proposed merged |
|---|---:|---:|---:|
| artist | 380 | 7 | 387 |
| equipment | 33 | 0 | 33 |
| festival | 62 | 1 | 63 |
| label | 49 | 0 | 49 |
| venue | 42 | 0 | 42 |
| total | 566 | 8 | 574 |
| ko_established | 91 | 0 | 91 |

현재 production JSON의 metadata `counts.total=541`은 실제 566과 불일치한다. 병합 시 기존 metadata에 8만 더하지 말고 위처럼 전체 배열에서 재계산해야 한다.

## Production merge proposed diff

아래는 승인 후 적용할 제안이며 아직 적용하지 않았다.

### `lib/edm-entities-v2.json`

```diff
   "counts": {
-    "artist": 360,
+    "artist": 387,
     "equipment": 33,
-    "festival": 60,
+    "festival": 63,
     "label": 49,
-    "venue": 39,
-    "total": 541,
+    "venue": 42,
+    "total": 574,
     "ko_established": 91
   }
```

`research/entity-addendum-2026-08-04.json`의 8개 entity object를 `entities` 배열 끝에 그대로 append한다. Ozora의 `aliases_en`에는 loader validation을 위해 `Ozora`를 유지하되 아래 surface policy가 이를 contextual surface로 전환한다.

### `lib/entity-surface-policy.json`

```diff
   "entities": {
+    "O.Z.O.R.A. Festival": {
+      "contextual_surfaces": {
+        "Ozora": {
+          "before": [
+            "festival",
+            "psytrance",
+            "psychedelic trance"
+          ],
+          "after": [
+            "festival",
+            "psytrance",
+            "psychedelic trance"
+          ],
+          "max_gap_chars": 12
+        }
+      }
+    },
     ...
   }
```

Production matcher/eligibility code 변경은 제안하지 않는다.

## Full-content 제거 proposed diff

현재 audit runner의 article row:

```diff
+import { createHash } from 'node:crypto'
 ...
-      content: article.content,
+      excerpt: (article.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 800),
+      contentLength: (article.content ?? '').length,
+      contentHash: createHash('sha256').update(article.content ?? '').digest('hex'),
```

기존 full-content audit JSON을 이 변경으로 다시 생성한 proposed 결과:

- `research/entity-recall-audit-2026-08-04.sanitized-proposed.json`
- 123건 모두 `content` 필드 없음
- 123건 모두 `excerpt`, `contentLength`, `contentHash` 존재
- excerpt 최대 800자

Merge-readiness runner와 그 JSON 출력은 처음부터 같은 제한을 적용해 full content를 저장하지 않는다.

## 남은 blocker

1. `Better`, `ADVANCED`, `Bandcamp` 기존 broad surfaces가 확인된 false positive를 만든다.
2. `ENTITY_HAYSTACK_CONTENT_LIMIT=500` 이전에 navigation/boilerplate가 긴 기사에서 실제 entity를 놓친다.
3. 특정 entity가 없는 electronic production guide·dance culture 기사는 dictionary만으로 해결할 수 없다.
4. Explicit fallback의 `DJ`는 비EDM 범죄·일반 음악 기사도 통과시킨다.
5. Addendum의 과거 3개 selected batch 재등장은 없어서 반복 recall 개선 근거는 제한적이다.
6. 과거 ground truth 21건과 현재 6건은 extraction/장르 경계 때문에 ambiguous다.
7. 현재 production dictionary metadata counts가 실제 배열과 불일치한다.
8. 원본 `research/entity-recall-audit-2026-08-04.json`은 아직 full content를 포함한다. 승인 후 sanitized proposed 파일로 교체해야 한다.

## 승인 대기

이 문서는 merge-ready proposed diff다. Production dictionary, surface policy, code, DB는 변경하지 않았고 commit도 하지 않았다.
