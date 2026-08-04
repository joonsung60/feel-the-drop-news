# 2026-08-04 entity recall audit

## 1. 결론

Entity dictionary는 이 batch의 **주요 recall blocker**다. Editorially relevant인데 현재 gate에서 탈락한 20건 중 `missing_entity` 15건과 `alias_missing` 1건, 합계 16건(80%)이 dictionary coverage와 직접 관련됐다. 다만 dictionary만이 유일한 blocker는 아니다. 500자 제한, entity로 풀 수 없는 주제형 기사, 충돌 가능 surface, broad fallback도 결과에 영향을 줬다.

검증된 8개 후보를 메모리에서만 합친 counterfactual은 false negative를 20건에서 12건으로 8건 줄였고, false positive를 늘리지 않았다. 이 후보 addendum은 **merge 권장**이다. Production 병합은 수행하지 않았다.

## 2. 현재 123건 funnel

- Batch 조건: `fetched_at >= 2026-08-04T08:46:35Z`, `fetched_at <= 2026-08-04T08:49:30Z`
- 조회 건수: 123 (기대값 123과 일치)
- qualifying: 39
- danceExperience: 0
- supportingOnly: 0
- notMatched: 84
- explicit fallback: 20
- 최종 LLM eligible: 59

Production의 `loadEntityDictionary`, `buildEntityIndex`, `partitionArticlesByEntityRole`, `selectEligibleLlmInput`, `hasExplicitEdmEvidence`를 직접 사용했다. `ENTITY_HAYSTACK_CONTENT_LIMIT=500`, `LLM_INPUT_MAX=120`, `NO_ENTITY_RATIO_MAX=0.6`을 그대로 적용했다.

### Source별 funnel

| Source | Total | Qualifying | Dance | Supporting | Not matched | Explicit fallback | Eligible |
|---|---:|---:|---:|---:|---:|---:|---:|
| 5 Magazine | 4 | 0 | 0 | 0 | 4 | 4 | 4 |
| 909originals | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| Attack Magazine | 1 | 1 | 0 | 0 | 0 | 0 | 1 |
| Bandcamp Daily | 3 | 3 | 0 | 0 | 0 | 0 | 3 |
| Bandwagon Asia | 10 | 1 | 0 | 0 | 9 | 0 | 1 |
| Beatburguer | 2 | 1 | 0 | 0 | 1 | 1 | 2 |
| By The Wavs | 3 | 0 | 0 | 0 | 3 | 1 | 1 |
| Clash Magazine | 6 | 1 | 0 | 0 | 5 | 0 | 1 |
| Create Digital Music | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| Dancing Astronaut | 1 | 0 | 0 | 0 | 1 | 1 | 1 |
| Data Transmission | 1 | 1 | 0 | 0 | 0 | 0 | 1 |
| Decoded Magazine | 3 | 1 | 0 | 0 | 2 | 2 | 3 |
| DJ Mag | 9 | 3 | 0 | 0 | 6 | 2 | 5 |
| DJcity News | 1 | 1 | 0 | 0 | 0 | 0 | 1 |
| EDM Maniac | 3 | 2 | 0 | 0 | 1 | 0 | 2 |
| EDM MAXX | 2 | 2 | 0 | 0 | 0 | 0 | 2 |
| EDM Sauce | 1 | 0 | 0 | 0 | 1 | 1 | 1 |
| EDMTunes | 9 | 5 | 0 | 0 | 4 | 2 | 7 |
| Electronic Groove | 8 | 5 | 0 | 0 | 3 | 0 | 5 |
| Groove Magazine (DE) | 2 | 0 | 0 | 0 | 2 | 0 | 0 |
| Juno Daily | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| Magnetic Magazine | 10 | 4 | 0 | 0 | 6 | 0 | 4 |
| Mixmag | 4 | 0 | 0 | 0 | 4 | 0 | 0 |
| MusicTech | 3 | 0 | 0 | 0 | 3 | 2 | 2 |
| Neural | 1 | 0 | 0 | 0 | 1 | 0 | 0 |
| Parkett Channel | 10 | 0 | 0 | 0 | 10 | 1 | 1 |
| Ransom Note | 3 | 0 | 0 | 0 | 3 | 0 | 0 |
| Synthtopia | 4 | 3 | 0 | 0 | 1 | 1 | 4 |
| The Quietus | 4 | 0 | 0 | 0 | 4 | 0 | 0 |
| We Rave You | 10 | 4 | 0 | 0 | 6 | 2 | 6 |
| When We Dip | 1 | 1 | 0 | 0 | 0 | 0 | 1 |

## 3. Editorial confusion matrix

Source 이름은 판정 근거로 사용하지 않았다. 기사 제목과 저장된 본문을 기준으로 `editorially_relevant` 72건, `editorially_irrelevant` 45건, `ambiguous` 6건으로 분류했다. 각 기사별 제목과 본문 excerpt는 JSON audit에 기록돼 있다.

| Metric | Value |
|---|---:|
| True positive | 52 |
| False positive | 6 |
| False negative | 20 |
| True negative | 39 |
| Ambiguous | 6 |
| Precision | 89.66% |
| Recall | 72.22% |

False positive 6건은 broad surface 또는 fallback의 한계를 보여준다. 대표적으로 eMTB 기사에서 `ADVANCED`, 힙합 DJ 추모 기사에서 `Better`, punk 기사에서 `Bandcamp`가 qualifying match가 됐다. `DJ` 단어만으로 통과한 범죄 기사와 metal 밴드 산업 기사도 있었다.

## 4. False negative 원인

| Cause | Count | Share of FN | Representative |
|---|---:|---:|---|
| missing_entity | 15 | 75% | Christian Hornbostel, Moojo, Eliza Rose, Ozora, Giom 기사 |
| alias_missing | 1 | 5% | `Tiestö` 오기 때문에 `Tiësto` 미매칭 |
| ambiguous_surface_policy | 1 | 5% | `DASH`는 일반명사 충돌 때문에 strong alias로 안전하지 않음 |
| entity_after_500_chars | 1 | 5% | Push 3 기사에서 기존 `Ableton`이 content 797자 지점에 등장 |
| explicit_edm_pattern_too_narrow | 0 | 0% | 해당 없음 |
| extraction_failure | 0 | 0% | ambiguous에는 extraction 불충분 사례가 있으나 확정 FN에는 없음 |
| classification_not_solvable_by_entity | 2 | 10% | MIDI controller 일반 가이드, disco-ball 문화사 |
| other | 0 | 0% | 해당 없음 |

Recall blocker 관점에서 기존 dictionary entity가 있음에도 gate를 잃은 확정 FN은 500자 제한 1건이었다. Boundary 또는 기존 contextual policy 때문에 탈락한 확정 FN은 없었다. Missing/alias 16건이 훨씬 컸다.

## 5. Addendum 전후 counterfactual

| Metric | Current | Addendum | Change |
|---|---:|---:|---:|
| Qualifying | 39 | 48 | +9 |
| Final eligible | 59 | 67 | +8 |
| False negative | 20 | 12 | -8 |
| False positive | 6 | 6 | +0 |
| Precision | 89.66% | 90.91% | +1.25%p |
| Recall | 72.22% | 83.33% | +11.11%p |

새로 통과한 기사는 8건이다.

- Christian Hornbostel 기사 → `Christian Hornbostel`
- Kashovski / Moojo 기사 → `Moojo`
- Eliza Rose / Sega Bodega 기사 → `Eliza Rose`
- Deadcrow / Caster 기사 → `Deadcrow`
- Venezuela charity compilation 기사 → `Hernán Cattáneo`, `Nick Warren`
- Ozora 사망 보도 2건 → `O.Z.O.R.A. Festival`
- Giom house classics 기사 → `Giom`

Qualifying 증가는 9건이지만 eligible 증가는 8건이다. Ozora 기사 중 하나는 현재도 explicit fallback으로 eligible이어서 pass path만 entity로 바뀐다.

## 6. Addendum 후보와 검증 근거

하루치 노출만으로 넣지 않고, 공식 또는 독립 자료에서 지속적인 electronic/dance relevance를 확인한 후보만 포함했다.

| Entity | Evidence |
|---|---|
| Christian Hornbostel | [Official biography](https://www.christianhornbostel.com/) — underground dance 활동과 장기 discography |
| Eliza Rose | [AllMusic biography](https://www.allmusic.com/artist/eliza-rose-mn0004313914) — electronic, club/dance, house, UK garage |
| Moojo | [Angeli Pierre artist profile](https://angelipierre.it/artista/moojo/) — Afro house/electronic DJ and producer |
| Nick Warren | [Insomniac artist profile](https://www.insomniac.com/music/artists/nick-warren/) — progressive/electronic/techno/house 경력 |
| Hernán Cattáneo | [Resident Advisor biography](https://ra.co/dj/hernancattaneo/biography) — house DJ/producer 경력 |
| Deadcrow | [Monstercat artist profile](https://www.monstercat.com/artist/deadcrow) — hardstyle, DnB, dubstep, dance/electronic releases |
| Giom | [Official biography](https://giom.co.uk/biography/) — deep/west-coast/nu-disco/French house 경력 |
| O.Z.O.R.A. Festival | [Visit Hungary](https://visithungary.com/event/ozora-festival) — 장기 psychedelic music/culture 행사 |

일반명사 충돌 surface는 넣지 않았다. 확립된 한국어 표기를 검증하지 못했으므로 8개 모두 `ko=null`, `ko_status="none"`이다. 별도 surface-policy addendum은 생성하지 않았다.

## 7. Merge 판정

**Merge 권장.** 보수적인 8개 후보만으로 recall이 11.11%p 개선되고 false positive 증가는 없었다. 단, 실제 production 병합 전에는 편집자 승인과 별도 날짜 batch 회귀 검증을 권장한다.

## 8. Entity 이외의 blocker

- `ENTITY_HAYSTACK_CONTENT_LIMIT=500`: 저장된 본문 앞부분이 사이트 navigation/boilerplate인 기사에서 실제 artist 또는 brand가 500자 뒤로 밀린다.
- Explicit fallback의 비대칭: `DJ`는 범죄·metal 기사까지 통과시키지만 `house` 단독, `psytrance` 복합어, 일부 bass/synth 문맥은 놓친다.
- Entity로 해결하기 어려운 주제형 기사: 장비 일반 가이드와 dance-culture history는 특정 고유명사 없이도 relevant하다.
- Existing broad surfaces: `ADVANCED`, `Better`, `Bandcamp` 같은 surface가 비EDM 기사에서 false positive를 만들었다.
- Extraction 품질: 일부 저장 본문이 비어 있거나 access-block 문구뿐이라 6건을 ambiguous로 남겼다.
- Existing dictionary metadata: loader는 566 entries를 읽었지만 `lib/edm-entities-v2.json`의 현재 `counts.total`은 541이다. 이 audit에서는 production loader 결과를 그대로 사용했고 production 파일은 수정하지 않았다.

## 9. 산출물과 검증

- `research/entity-recall-audit-2026-08-04.json`: 123건 상세 audit, source funnel, confusion matrix, FN 원인, counterfactual
- `research/entity-addendum-2026-08-04.json`: 기존 dictionary 최상위/entry 구조를 따른 8개 후보
- `research/run-entity-recall-audit-2026-08-04.ts`: 재현 가능한 SELECT-only audit runner
- Production dictionary, surface policy, production code, DB data는 수정하지 않았다.
