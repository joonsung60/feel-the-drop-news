# Korea dance discovery research manifest

Phase 0 keeps research inputs separate from executable gate fixtures.

- `source-candidates.json` and `event-gold-set.json` are immutable, reference-only
  research snapshots. Their hashes and counts are pinned in `manifest.json`.
- Gold `evidence` entries combine a URL with a researcher summary. They are not
  verbatim source quotations and must never be passed directly to
  `ground_experience_evidence()`.
- `fixtures/gate-cases.json` contains only short excerpts observed in official or
  primary HTML. Resident Advisor records remain reference-only: no RA page is an
  automated fixture source and Phase 0 adds no RA crawler or scraper.
- The combined input is intentionally omitted because it duplicates the two
  canonical snapshots.

Run the strict offline validation without a database, Ollama, or browser:

```bash
python3 research/korea-dance/validate.py
```

The current gate can verify that evidence is present in the selected source text.
It does **not** model source officiality, cross-source agreement, or a persistent
manual-review queue. `needs_verification` is logged by the correspondent observer
and, like `rejected`, is not inserted into `raw_articles`.
