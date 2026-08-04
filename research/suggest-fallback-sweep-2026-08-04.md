# Explicit fallback full RSS sweep — 2026-08-04

## Scope

`origin = rss`인 938건 전체를 Supabase SELECT-only로 조회했다. 기존 explicit pattern과 현재 `hasExplicitEdmEvidence`를 동일 title + 정제 본문 500자 haystack에서 비교했다.

## Delta

| Metric | Count |
|---|---:|
| Baseline explicit eligible | 299 |
| Current explicit eligible | 309 |
| Newly eligible | 17 |
| Newly eligible TP | 17 |
| Newly eligible FP | 0 |
| Removed from explicit fallback | 7 |

신규 TP는 synth/synthesizer/chiptune 장비·제작 기사와 전자음악/신스팝 릴리즈다. 최초 sweep에서 Aventon 전기자전거 기사가 본문의 “modular synth world” 비유로 추가되는 FP 1건을 발견했고, 제목의 e-bike/eMTB/전기·산악자전거 문맥만 제외하도록 보완한 뒤 재실행했다. 음악 장비 및 릴리즈 17건은 유지됐다.

DJ fallback 변경으로 Andrew Chow의 hip-hop/turntablist 기사는 제외됐다. 변경 전 일본어 fallback의 경계 없는 `DJ` 대안이 우연히 잡던 6건도 explicit delta에서는 빠졌지만, 이 결과는 최종 entity eligibility와 별개다.

## Bandcamp FN 검토

| 기사 주체 | 판정 | 근거 |
|---|---|---|
| sachi’s mirror | defer | 실제 아티스트와 릴리즈는 확인되지만 EDM 고유 entity로 넣을 만큼 장르 근거가 아직 약하다. |
| The Tape Label Report | reject | 여러 카세트 레이블을 묶는 정기 editorial series라 단일 entity 추가로 해결할 문제가 아니다. |
| Trackmatch | defer | DJ/컬렉터용 track-ID·digging 도구임은 공식 사이트로 확인되지만, 하루치 기사만으로 production equipment entity 승격은 이르다. |

이번 작업에서는 별도 dictionary addendum을 생성하지 않았다. Bandcamp는 supporting role을 유지한다.

검토 자료:

- sachi’s mirror: Spotify artist catalog, Apple Music artist catalog, BFF.fm airplay
- The Tape Label Report: Bandcamp Daily series description
- Trackmatch: `https://trackmatch.app/`의 공식 기능 설명

## Sanitization

JSON에는 기사 전문이 없고 excerpt 최대 800자, `contentLength`, SHA-256 `contentHash`만 저장했다.
