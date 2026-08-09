# Suggest 2 backlog audit — 2026-08-08

## Scope

- SELECT-only production snapshot generated at 2026-08-08T11:56:34.778Z.
- Backlog means currently eligible raw articles excluding the preferred RSS run and any explicit fresh correspondent run admitted by the recommended freshness window.
- Existing `/api/suggest-clusters/extended` query semantics and production `buildPairClusters` were reproduced. LLM was not called.
- Legacy means rows whose origin is neither `rss` nor `correspondent`, including historical null-origin rows.
- No article content is persisted in this report. Exact selection IDs and group IDs are in the JSON.

## Existing extended-route baseline

- Eligible rows before fresh-cohort exclusion: 6879
- Pair groups/articles: 53/172
- Top-30 group IDs are recorded in JSON.

## Backlog

- Total: 6745
- Origin RSS/correspondent/legacy: 924/30/5791
- Age 0–7/8–30/31–90/91+ days: 192/2182/4371/0
- Checked null/present: 6567/178
- Qualifying/supporting/not-matched: 2273/123/4349
- Pair groups/articles: 52/167
- Qualifying singleton-only: 2106
- Entity cap loss: 851 unique articles (995 memberships)
- Top-30 displaced groups: 22
- Unchanged-input deterministic repeat: 30/30

## Bounded selector comparison

| Policy | Budget | RSS/Corr/Legacy | Sources | Unchecked | Age buckets | Pair groups/articles |
|---|---:|---:|---:|---:|---:|---:|
| unchecked_source_round_robin | 100 | 39/21/40 | 41 | 100 | 37/63/0/0 | 3/13 |
| unchecked_source_round_robin | 200 | 89/21/90 | 42 | 200 | 66/134/0/0 | 9/30 |
| unchecked_source_round_robin | 500 | 239/21/240 | 42 | 500 | 137/363/0/0 | 20/64 |
| age_bucket_round_robin | 100 | 67/0/33 | 20 | 100 | 34/33/33/0 | 4/11 |
| age_bucket_round_robin | 200 | 133/0/67 | 29 | 200 | 67/66/67/0 | 6/17 |
| age_bucket_round_robin | 500 | 333/0/167 | 34 | 500 | 167/166/167/0 | 22/63 |
| origin_source_age_fair_queue | 100 | 39/21/40 | 26 | 100 | 24/56/20/0 | 3/12 |
| origin_source_age_fair_queue | 200 | 89/21/90 | 42 | 200 | 49/106/45/0 | 5/20 |
| origin_source_age_fair_queue | 500 | 239/21/240 | 42 | 500 | 124/256/120/0 | 23/67 |

## Recommendation

Keep the existing Suggest 2 route, UI name, and pair-clustering concept. Define its backlog as currently eligible rows outside admitted fresh cohorts. Use an origin/source/age fair queue with unchecked rows first, persist a cursor or checked timestamp only for groups actually submitted to the Suggest 2 LLM, and retain qualifying singleton backlog for later passes rather than sending singleton-only items through the pair-cluster LLM.
