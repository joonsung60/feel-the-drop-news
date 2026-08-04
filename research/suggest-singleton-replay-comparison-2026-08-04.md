# Suggest singleton-first replay comparison — 2026-08-04

## 결론

최종 uncommitted diff는 지정된 승인 조건을 모두 충족했다. LLM raw suggestion은 3회 모두 singleton이었고, 지정 오염 cluster와 명백한 비EDM saveable은 0건이었다. 정상 병합 4종은 세 run 모두 deterministic merge에서 유지됐다.

## Funnel

| Run | Eligible | Raw | Raw multi | Normalized | Merged | Ranked/saveable | LLM omissions | DB unchanged |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 64 | 60 | 0 | 57 | 51 | 30 | 4 | yes |
| 2 | 64 | 62 | 0 | 61 | 56 | 30 | 3 | yes |
| 3 | 64 | 63 | 0 | 61 | 55 | 30 | 1 | yes |

고정 seed는 사용하지 않았다. raw suggestion 수와 omission 수가 달라 실제 모델 변동성이 관찰됐다.

## 정상 병합

| Story | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Fred again.. / `9 months & 50 hours` | 유지 | 유지 | 유지 |
| Kaskade / `ORIGIN//` | 유지 | 유지 | 유지 |
| Vintage Culture / `Think Too Much` | 유지 | 유지 | 유지 |
| Ozora Festival / 사망·조기 종료 | 유지 | 유지 | 유지 |

Above & Beyond의 동일한 `One Mix` 보도도 입력 두 건이 모두 제안된 run 1·3에서 정상 병합됐다.

## 오염 cluster 전수검사

3회 merged suggestion의 모든 multi-article cluster를 기사 제목과 ID로 대조했다. 오염 cluster는 0건이다. 다음 금지 조합은 모든 run에서 분리됐다.

- Above & Beyond `One Mix` / Christian Hornbostel `Eridanus`
- Tomorrowland aftermovie / Cale Anderson
- Tomorrowland aftermovie / Aaron Hibell
- Tomorrowland 공연 세트 / Dimitri Vegas 별도 기사
- Tomorrowland 공연 세트 / official aftermovie
- Roland JD-990 / GO:KEYS 3
- KAMAYA / Eastern Electrics
- Bandcamp 펑크 / sachi’s mirror

## Eligibility aggregate

기존 401건 기준 TP 202, FP 10, FN 74, TN 88에서 Aventon 전기자전거 FP 1건이 제거됐다. 따라서 TP 202, FP 9, FN 74, TN 89, ambiguous 27이며 precision 0.9573, recall 0.7319다. 요구 하한 0.9528/0.7319를 충족한다.

## LLM omission

최종 run별 omission은 4/3/1건이었다. 공통적으로 모델이 생략한 hearing-protection 또는 ARC 추천 목록은 singleton-first 구조가 만든 cluster 오염은 아니다. 다만 LLM coverage 변동성은 남은 운영 blocker다. runner의 `llmOmittedArticles`에 전체 ID와 제목이 기록돼 있다.

## Saveable 검토

각 run의 30개 saveable을 전수 확인했다. 명백한 비EDM 제안은 0건이다. LLM이 singleton ID에 다른 기사의 내용을 붙이는 변동 사례는 normalization grounding 검사로 차단했다.

## 산출물

- `suggest-replay-2026-08-04-run-{1,2,3}.json`
- `suggest-replay-2026-08-04-run-{1,2,3}.md`
- `suggest-singleton-replay-comparison-2026-08-04.json`
- `suggest-singleton-replay-comparison-2026-08-04.md`
