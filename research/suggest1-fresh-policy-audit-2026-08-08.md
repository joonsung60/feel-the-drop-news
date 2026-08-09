# Suggest 1 fresh policy audit — 2026-08-08

## Scope

- SELECT-only production snapshot.
- Reference state: immediately before the production Suggest run at 2026-08-06T03:08:07.034Z.
- Preferred RSS ingestion run: `eb6018a4-7b23-4794-adcf-77fd06f90c79`.
- LLM was not re-run. Production matcher and eligibility functions were imported.
- Exact article IDs and per-suggestion/per-generated-article coverage are in the JSON.

## Result

| Freshness | Policy | Preferred/Fresh corr/Backlog/Legacy | Qual/Supporting/Not | Explicit/Eligible | Sources | Null share | Suggestions | Generated |
|---:|---|---:|---:|---:|---:|---:|---:|---:|
| 24h | Current | 70/0/20/10 | 32/2/66 | 21/53 | 36 | 0.17 | 30/30 | 3/5 |
| 24h | Fresh-70/30 | 100/0/0/0 | 26/4/70 | 20/46 | 34 | 0.04 | 14/30 | 1/5 |
| 24h | Fresh-80/20 | 100/0/0/0 | 26/4/70 | 20/46 | 34 | 0.04 | 14/30 | 1/5 |
| 24h | Preferred-first | 100/0/0/0 | 26/4/70 | 20/46 | 34 | 0.04 | 14/30 | 1/5 |
| 72h | Current | 70/0/20/10 | 32/2/66 | 21/53 | 36 | 0.17 | 30/30 | 3/5 |
| 72h | Fresh-70/30 | 100/0/0/0 | 26/4/70 | 20/46 | 34 | 0.04 | 14/30 | 1/5 |
| 72h | Fresh-80/20 | 100/0/0/0 | 26/4/70 | 20/46 | 34 | 0.04 | 14/30 | 1/5 |
| 72h | Preferred-first | 100/0/0/0 | 26/4/70 | 20/46 | 34 | 0.04 | 14/30 | 1/5 |
| 168h | Current | 70/0/20/10 | 32/2/66 | 21/53 | 36 | 0.17 | 30/30 | 3/5 |
| 168h | Fresh-70/30 | 100/0/0/0 | 26/4/70 | 20/46 | 34 | 0.04 | 14/30 | 1/5 |
| 168h | Fresh-80/20 | 100/0/0/0 | 26/4/70 | 20/46 | 34 | 0.04 | 14/30 | 1/5 |
| 168h | Preferred-first | 100/0/0/0 | 26/4/70 | 20/46 | 34 | 0.04 | 14/30 | 1/5 |

Latest explicit correspondent ingestion cohort: none. The 24h/72h/7d windows therefore have no explicit correspondent cohort to admit.

The five generated articles are the latest five production articles linked through suggestion clusters. 3 belong to this 30-suggestion run; the remainder belongs to an earlier suggestion. Coverage is measured from each linked suggestion's raw article IDs.

## Recommendation

Keep a 70% preferred RSS entitlement and reserve up to 30% for a correspondent cohort no older than 72 hours. This dataset has no explicit correspondent cohort in any tested window, and filling the missing correspondent quota only from preferred RSS reduces coverage of the 30 production suggestions and five generated articles; therefore fall the unused share back to the existing fair remainder rather than preferred-only refill. If no preferred run exists, resolve the latest eligible explicit ingestion run and retain cohort_fair_v1.
