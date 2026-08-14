# Suggest 2 strict precision validation — 2026-08-11

## Approval

- Code approval: **not yet**. Gold and validator tests pass, but the proposed graph creates excessive overlapping candidates on the full backlog.
- Production-quality approval: **no**. Full-candidate precision is not established and Ollama 3-run stability was not available.

## Gold consistency and recall

The audit JSON is the editorial source of truth. The two Phara-O Mini editor articles are distinct releases: Vlastimil Cerveny released a browser editor, while Momo Müller released a separate desktop/plugin editor. They were removed from the same-story expected groups and now have a distinct-subject regression test.

Combined-60 uses one article array, the production dictionary/index, and one proposed pair-build call. Result: 13 candidates, 13 editorial-pure, 0 impure. The corrected gold contains 11 expected exact-story groups: 9 retained, 2 missed, exact-set recall **81.8%**. All four known-good saved clusters are retained as exact article sets.

Misses are explicit rather than repaired with literals:

- `gold-1-1`: three-article event preview split into two overlapping two-article anchors.
- `gold-14-2`: firmware release/demo follow-up pair missed because subject/lifecycle/object wording does not yield one shared strict signature.

No expected exact group was emitted twice. Detailed story IDs, article IDs, audit fingerprints, retention, fragmentation, and duplicate counts are in `suggest2-gold-consistency-replay-2026-08-11.json`.

## Frozen full-backlog comparison

Snapshot `2026-08-11T04:12:24.353Z` selected 7,097 eligible rows once, excluded the same fresh cohort, and fixed 7,045 backlog rows in memory. Each article is recorded by ID, content length, and SHA-256; URL and full content are absent.

| Metric | Legacy HEAD builder | Proposed strict builder |
|---|---:|---:|
| Candidates | 41 | 354 |
| Exact article-set overlap | 7 | 7 |
| Only in algorithm | 34 | 347 |
| Size 2 / 3 / 4 / 5 | 23 / 10 / 2 / 6 | 271 / 51 / 15 / 17 |
| Groups overlapping another group | 0 | 199 |

Both algorithms use the same rows, dictionary, entity index, 15-cap selector, fresh exclusion, and post-build ordering. Dictionary entries have no reliable entity-type field, so an entity-type precision table is not fabricated.

## Editorial audit status

All 354 candidate records contain order, entity, anchor, IDs, title, source, dates, ≤500-character sanitized excerpt, content length/hash, fingerprint placeholder, broad-anchor flag, verdict and reason. The actual top 30 were manually compared: 23 same-story, 5 related-but-distinct, 2 unrelated, 0 ambiguous; candidate precision **76.7%**. Examples of failures include an entity-name anchor joining unrelated Thomas Bangalter stories, a broad Swedish House Mafia grouping, and mixed golf/music stories. The remaining 324 are explicitly `ambiguous/needs_review`; therefore all-candidate precision is `null`, not an invented value.

The backlog also demonstrates that general phrases such as `be reissued` and regional/descriptive anchors require a corpus/entity-local discriminative score or primary-object agreement. No phrase-specific production blacklist was added.

## LLM validator

Exact ID coverage remains mandatory for approve and reject. Date strings are parsed into local calendar dates, location containment permits `Brooklyn` versus `Under The K Bridge, Brooklyn`, and lifecycle compatibility permits same-object release/premiere/review plus incident follow-up/investigation. Different album and advance-single objects still reject. All cases have regression tests.

Ollama was unavailable at `localhost:11434`, so the required three independent top-30/known-good dry runs were not performed. No DB checked/save mutation occurred.

## Invariants and remaining blockers

No production gold literal was added. Suggest 1, selection/LRU, dictionary, article generation, migrations, and `research/korea-dance/*` were untouched by this work. DB access was SELECT-only; Git remains unstaged/uncommitted.

Before approval: finish human editorial review of 324 ambiguous groups, introduce a general discriminative/primary-object rule, rerun the identical frozen snapshot to measure precision/recall and overlap reduction, then complete Ollama three-run validation.
