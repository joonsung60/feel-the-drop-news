# Production Suggest 2 cluster precision audit — 2026-08-10

## 범위와 방법

- 대상: `suggested_clusters.created_at = 2026-08-10T13:05:03.572266+00:00`인 Production 16건.
- Supabase MCP로 `SELECT`만 실행했다. Production mutation, LLM 재실행, stage/commit/push는 하지 않았다.
- 각 suggestion의 `article_ids` 배열 순서를 보존해 `raw_articles`와 `rss_sources`를 조회했다.
- 판정 단위는 주제 유사성이 아니라 **동일한 구체 사건·릴리즈·행사·사고**다. 모든 기사가 같아야 `same_story`다.
- `article contamination`은 각 cluster에서 가장 큰 exact-story subset만 남기기 위해 제거해야 하는 최소 기사 수다.
- 기사별 원문 메타데이터, 800자 미만 sanitized excerpt, 6축 story fingerprint의 완전한 구조화 기록은 [JSON](./suggest2-cluster-precision-audit-2026-08-10.json)에 있다. 이 문서와 JSON 모두 기사 전문과 URL, 비밀값을 저장하지 않는다.

## 결론

16건 중 strict `same_story`는 4건으로 precision은 **25.0% (4/16)**다. 나머지는 `related_but_distinct` 8건, `unrelated` 4건, `ambiguous` 0건이다. 60개 기사 중 최소 **28개가 contamination**이다.

| 판정 | 수 | 비율 |
|---|---:|---:|
| same_story | 4 | 25.0% |
| related_but_distinct | 8 | 50.0% |
| unrelated | 4 | 25.0% |
| ambiguous | 0 | 0.0% |

LLM 승인 16건 중 타당한 것은 Christian Hornbostel/Eridanus, Boiler Room anti-KKR incident, Showtek/F_CK THE SYSTEM, Agents Of Time/Nova Luna 네 건뿐이다. `published`였던 세 건(Shambhala, Blanke, CAPSULE/Modis)은 모두 strict same-story가 아니었다. 여기서 `published`는 감사 시점의 suggestion 상태이며 LLM 승인 당시의 품질 판정과 구분했다.

## Cluster별 판정

| Suggestion | topic / status | 공통 canonical entity | 기사 | 판정 | LLM approve | 오염 |
|---|---|---|---:|---|---|---:|
| `17e2ad9c-41bf-469d-8e3a-6ec5c9f55b42` | Klangkuenstler OUTWORLD LA / pending | Klangkuenstler | 5 | unrelated | 부당 | 2 |
| `3d8e5a8f-cdd1-4382-a644-9ae8c0c36bf4` | Chemical Brothers anniversaries / pending | The Chemical Brothers | 4 | related_but_distinct | 부당 | 2 |
| `5e6994d4-8343-4bcc-ae5f-a4dae1a89125` | RÜFÜS DU SOL tour/features / pending | RÜFÜS DU SOL | 5 | unrelated | 부당 | 4 |
| `67f088fa-5fe3-45af-ad8f-8103d0ab886c` | Tomorrowland 2027 / pending | Tomorrowland | 3 | related_but_distinct | 부당 | 1 |
| `72b0090f-0b7a-4e6b-868a-14c125c90b2c` | Christian Hornbostel — Eridanus / pending | Christian Hornbostel | 3 | same_story | 타당 | 0 |
| `a6ea29b2-cc75-4562-b62f-17a001561589` | Shambhala report + missing attendee / published | Shambhala Music Festival | 2 | related_but_distinct | 부당 | 1 |
| `a6ec6a9a-1c41-4100-ac6f-41d0b8724fe1` | Crosstown Rebels releases / pending | Crosstown Rebels | 5 | related_but_distinct | 부당 | 3 |
| `ad3676cd-5a90-4580-a1c9-74ffbb757c5a` | Boiler Room anti-KKR incident / pending | Boiler Room | 3 | same_story | 타당 | 0 |
| `c468161f-4ae3-4023-a591-a331b10c964e` | Blanke album EP series / published | Blanke | 5 | unrelated | 부당 | 3 |
| `c75f04c7-c1ec-4a46-b058-ed5dc673653c` | Showtek label launch / pending | Showtek | 4 | same_story | 타당 | 0 |
| `d4c682b2-dbcf-4778-b016-9020bf8e8bbc` | Behringer products/software / pending | Behringer | 5 | related_but_distinct | 부당 | 3 |
| `deaa3d06-0f3a-4081-a325-b67cfe9acfa0` | Monstercat releases / pending | Monstercat | 5 | related_but_distinct | 부당 | 4 |
| `eaffbac6-8937-40f5-8d03-e4ba7c886a91` | Agents Of Time — Nova Luna / pending | Agents Of Time | 2 | same_story | 타당 | 0 |
| `f14d51c3-f8e8-4936-afa1-963816086c91` | Elektron products/firmware / pending | Elektron | 5 | related_but_distinct | 부당 | 3 |
| `f7cad637-19d1-4c78-a393-a1c48483546c` | CAPSULE/Modis album / published | CAPSULE | 2 | related_but_distinct | 부당 | 1 |
| `fcd12dc0-e39a-491e-b6b6-1afc007040f8` | MK Zone + A Nu Day / pending | MK | 2 | unrelated | 부당 | 1 |

## 반드시 별도 확인할 사례

### MK Zone / Lem Springsteen & Imaani

- `ab8be7bc-66fb-432d-bb42-9aef32f4c362`: Lem Springsteen & Imaani의 `A Nu Day` 리뷰. 본문에서 MK는 필자의 과거 classic-house 컬렉션 예시로만 언급된다.
- `76b5bc42-9180-4e4b-bc08-0b887d7ae7a1`: MK & Poppy Baskcomb의 별도 신곡 `Zone` 리뷰.
- subject/action/object가 모두 다르다. shared artist surface가 단순 언급을 주제 근거로 오인했고, LLM은 system prompt의 “단순 언급이 섞이면 reject” 규칙을 정면으로 위반했다. `unrelated`.

### Shambhala report / missing attendee

- `1e17301b-4dc8-426a-b4b8-26e5a98a4c38`: 2026 festival 전반 report card.
- `82b9bf0d-7134-4602-8fdb-838eb2af7c25`: 실종 신고된 Kayla Boisvert가 안전하게 발견됐다는 개별 사건의 resolution.
- 같은 festival과 시기지만 기사 lifecycle은 recap 대 incident resolution이다. `related_but_distinct`이며, 이미 `published` 상태라는 점에서 실사용 영향이 확인된다.

### Blanke group — Nocturnalist 581·572

- `54c87a0a-6efc-4df3-9091-4f60d094d7ff` (`Nocturnalist 581`)와 `87a94d55-c62d-4fb8-86f0-966728fa4b17` (`Nocturnalist 572`)는 각각 다수 아티스트가 든 주간 playlist roundup이다.
- `581`과 `572`는 서로 다른 주차이며 `SKYFIRE` 릴리즈 보도가 아니다. `572`에는 Blanke/Ella Pole 트랙이 목록 항목으로 들어갈 뿐이다.
- exact core는 `4eee0deb-...`와 `6c928e73-...`의 `PART II – SKYFIRE` 두 기사다. `df165312-...`는 두 달 뒤 `PART III – AWAKENING` 인터뷰다. 최소 contamination 3, cluster는 `unrelated`.

### Crosstown Rebels broad grouping

Rafael의 `Gotta Be Cool`, Emanuel Satie의 `A Love Fantasy`(2건), Alex Wann/JUNO의 `Allo`, Aurisé의 `Resolve`는 같은 레이블의 서로 다른 릴리즈다. largest exact-story subset은 Emanuel Satie 2건뿐이다. shared label, broad connected component와 LLM over-approval이 겹쳤다.

### Monstercat broad grouping

`STFU`, `Heart On Fire`, `Release Me`, `FEAR`, `Disconnected Again`은 아티스트·곡명이 모두 다른 5개 릴리즈다. 공통점은 Monstercat/Uncaged label context와 7월 8~10일의 게시 근접성이다. strict same-story subset 최대 크기는 1이며 contamination은 4다. component 중심성 상위 5개를 택하는 방식이 “최근 label roundup”을 만들어 냈다.

### Chemical Brothers anniversary grouping

`Exit Planet Dust` 31주년/Discord 행사, `Leave Home` 31주년, `Hey Boy Hey Girl` 27주년, `Go` live visuals 공개는 한 사건이 아니다. 아티스트와 “anniversary/release”라는 서술 범주가 같을 뿐 object와 lifecycle이 다르다. `related_but_distinct`.

### CAPSULE/Modis 두 기사

- `08772dea-83ab-4fea-8be6-4eebf246799a`: Modis(Rafael Caivano)의 debut album `Capsule` 발매/작품론.
- `0bd8fa41-36d4-4bdd-9a14-3dd345df928c`: 두 달 전 앨범 선공개 싱글 `Aligned` premiere.
- 실제 subject는 Modis이고 `CAPSULE`은 이 문맥에서 앨범명이다. dictionary canonical `CAPSULE` 표면이 제목/앨범명을 qualifying entity처럼 잡은 generic-title collision이다. 같은 rollout이지만 single premiere와 album release/feature이므로 strict 기준에서는 `related_but_distinct`.

## 나머지 핵심 관찰

- Klangkuenstler: OUTWORLD LA 중복 3건에 Mumbai 사망 조사와 MELTX mix가 붙었다.
- RÜFÜS DU SOL: Boston, MSG, Paris의 서로 다른 공연/성과에 similar-artists editorial과 2016년 `Innerbloom` 해설까지 묶였다.
- Tomorrowland: Las Vegas 신설 edition과 Alpe d'Huez의 Tomorrowland Winter는 별도 행사다.
- Behringer: AKS Mini 2건, 서로 다른 개발자의 Phara-O Mini editor 2건, BCR/BCF editor 1건이다.
- Elektron: Analog Four OS 1.55 2건, Monomachine third-party firmware release/demo 2건, Outbox 8 product preview 1건이다.

## 원인별 빈도

원인은 multi-label이다. 한 cluster에 여러 원인이 동시에 적용되므로 합계는 16을 넘는다.

| 원인 | cluster 수 | 설명 |
|---|---:|---|
| shared artist | 5 | Klangkuenstler, Chemical Brothers, RÜFÜS DU SOL, Blanke, MK |
| shared label | 2 | Crosstown Rebels, Monstercat |
| shared festival | 2 | Tomorrowland, Shambhala |
| generic title term | 1 | CAPSULE album-title collision |
| broad connected component | 12 | impure cluster 전부 |
| entity 15-cap | 0 | 이 16개 저장 cluster에서 인과 증거 없음 |
| event-date weakness | 12 | impure cluster의 DB `event_date`가 전부 null이라 guard가 한 번도 작동하지 않음 |
| LLM validator over-approval | 12 | impure candidate 전부를 reject하지 못함 |
| 기타: shared brand/manufacturer | 2 | Behringer, Elektron |

`entity 15-cap`은 코드상 entity별 후보를 먼저 15건으로 자르는 recall/구성 위험이지만, 이 16개 저장 cluster만으로 해당 cap이 실제 원인이었다는 증거는 없으므로 빈도는 0으로 잡았다. 별개인 **component 5-cap/중심성 선택**은 Crosstown Rebels·Monstercat 등 broad component의 최종 구성을 5건으로 압축했다.

## deterministic pair graph와 LLM 책임 분리

### Deterministic pair graph가 만든 문제

코드상 pair score는 shared qualifying entity 1개에 1점, 게시일 3일 이내에 3점, 7일 이내에 1점, generic stoplist를 뺀 title token 하나 공유에 2점을 준다. threshold는 3점이다. 따라서 다음이 가능하다.

- 같은 레이블의 서로 다른 릴리즈가 게시일만 가까우면 entity 1 + date 3으로 edge가 된다.
- 같은 아티스트/브랜드와 흔한 title token이면 entity 1 + title 2로 edge가 된다.
- union-find가 pair edge를 transitive하게 합치므로 모든 기사쌍이 같은 story일 필요가 없다.
- component가 5개를 넘으면 edge centrality 상위 5개만 남겨, broad pool이 그럴듯한 5건 묶음으로 보인다.
- `canMergeByEventDate`는 알려진 `event_date`가 둘 이상 충돌할 때만 막는다. 감사한 60개 모두 `event_date = null`이어서 아무 edge도 차단하지 못했다.

이로 인해 12개 impure candidate component가 LLM 앞에 도달했다. 이는 **candidate construction precision 실패**다.

### LLM이 거절하지 못한 문제

Suggest 2 system prompt는 “모두 같은 뉴스인지” 판단하고, 서로 다른 사건 또는 단순 언급이 하나라도 섞이면 `approved: false`를 요구한다. 따라서 graph가 broad candidate를 만들었더라도 LLM은 12건 모두 거절했어야 한다. 특히 MK 단순 언급, Nocturnalist roundup, Shambhala incident/report, 다섯 개 서로 다른 Monstercat 곡은 excerpt 수준에서도 분명하다.

즉 12건은 graph 실패이자 각각 별도의 **validator false approval**이다. 두 수치는 책임 layer별로 분리하며 합산하지 않는다.

## Suggest 1 merge guard 재사용 범위

재사용 가치가 높은 부분은 다음과 같다.

- grounded discriminative story term: keyword를 믿지 않고 모든 원문 title/snippet에 실제로 존재하는 release title, incident phrase, venue/date, product model만 story key로 인정.
- generic story terms와 source/series entity 제외.
- shared canonical entity만으로 merge하지 않고 discriminative overlap을 추가 요구.
- known event-date conflict 차단.
- merge 후 cohesion이 떨어지면 원래 suggestion들을 보존하는 rollback.

그대로 호출하는 것만으로는 부족하다. Suggest 1 guard는 이미 normalized된 suggestion 사이 merge를 판정하지만 Suggest 2는 raw article pair에서 graph를 만든다. 그러므로 동일 개념을 **각 pair edge 이전**에 적용하고, union 후에는 component 전체에 하나의 common grounded story key가 있는지 다시 확인해야 한다.

## 최소 수정안과 recall tradeoff

1. Pair edge에 grounded discriminative story key를 필수화한다. shared entity + 게시 근접만으로는 edge를 만들지 않고, 곡/EP/앨범명, incident phrase, venue+날짜, product model 중 하나를 양쪽 원문에서 확인한다.
   - 예상 tradeoff: 짧거나 다국어인 중복 제목에서 공통 key가 content 앞부분에 없으면 낮음~중간 수준 recall 하락.

2. Transitive component를 LLM에 보내기 전에 common-story 검사를 한다. 모든 node가 하나의 공통 grounded key로 연결되지 않으면 split하거나 fail-closed reject한다.
   - 예상 tradeoff: 보도 lifecycle이 진행되며 표현이 크게 바뀌는 evolving story는 일부 분리될 수 있어 중간 수준 recall 하락. 대신 artist/label/festival broad grouping은 크게 줄어든다.

3. 명시 날짜를 `event_date`로 채우고 deterministic validator를 추가한다. playlist/roundup은 본문 목록의 단순 artist mention으로 qualifying하지 않으며, cluster 안에 release title/product model/venue/event date가 복수이면 LLM 승인 후에도 reject한다.
   - 예상 tradeoff: clean duplicate recall 손실은 낮다. Modis의 single→album 같은 rollout은 의도적으로 strict same-story에서 분리된다.

## 재현과 데이터 안전

별도 runner는 만들지 않았다. Supabase MCP `execute_sql`로 정확한 timestamp의 suggestion rows와 `unnest(article_ids) with ordinality` 결과를 SELECT-only 조회하는 것으로 충분했다. excerpt는 SQL에서 HTML tag와 whitespace를 정리하고 최대 800자로 잘랐으며, 산출물에는 더 짧은 사실 근거만 저장했다. 기사 전문, URL, 환경변수, 키, 토큰은 저장하지 않았다.

## 검증

요청한 검증 결과는 작업 종료 시점의 실제 명령 결과를 기준으로 아래에 기록한다.

- JSON parse: 통과
- `npx tsc --noEmit`: 통과
- runner ESLint: runner 미생성으로 해당 없음
- `git diff --check`: 통과
- 지정 산출물 외 코드/DB/Git 변경: 없음. 기존 사용자 변경인 `research/korea-dance/event-gold-set.json`, `research/korea-dance/source-candidates.json`은 건드리지 않음.
