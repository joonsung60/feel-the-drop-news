# Suggest pool D-policy fidelity — 2026-08-05

The comparison uses the exact SELECT-only candidate snapshot and editorial labels from the 2026-08-04 audit. Exact article IDs are stored in the JSON.

The original audit removes only the designated 123-row RSS cohort before fair remainder selection. The latest correspondent cohort remains in `newestByOrigin`, so its dated/null queues receive weight 3.

| Limit | Policy | Relevant recall | RSS/Corr/URL/Unknown | Correspondent cohort | True backlog | Sources | Null share |
|---:|---|---:|---:|---:|---:|---:|---:|
| 100 | D-original | 0.6111 | 78/16/0/6 | 10/10 (1) | 20/6478 (0.0031) | 32 | 0.21 |
| 100 | D-equal | 0.6111 | 80/10/0/10 | 6/10 (0.6) | 24/6478 (0.0037) | 32 | 0.18 |
| 120 | D-original | 0.7083 | 94/18/0/8 | 10/10 (1) | 26/6478 (0.004) | 32 | 0.2083 |
| 120 | D-equal | 0.7083 | 96/12/0/12 | 7/10 (0.7) | 29/6478 (0.0045) | 32 | 0.1833 |
| 200 | D-original | 1 | 147/31/0/22 | 10/10 (1) | 67/6478 (0.0103) | 34 | 0.225 |
| 200 | D-equal | 1 | 149/26/0/25 | 9/10 (0.9) | 68/6478 (0.0105) | 35 | 0.21 |
