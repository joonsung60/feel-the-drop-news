alter table public.raw_articles
  add column if not exists ingestion_run_id uuid,
  add column if not exists ingestion_source text;

create index if not exists raw_articles_suggest_ingestion_run_idx
  on public.raw_articles (
    ingestion_run_id,
    suggestion_last_checked_at asc nulls first,
    published_at desc nulls last,
    fetched_at desc,
    id
  )
  where (suggestion_state is null or suggestion_state = 'new')
    and ingestion_run_id is not null;

create index if not exists raw_articles_suggest_fair_queue_idx
  on public.raw_articles (
    origin,
    (published_at is null),
    suggestion_last_checked_at asc nulls first,
    published_at desc nulls last,
    fetched_at desc,
    id
  )
  where suggestion_state is null or suggestion_state = 'new';

create index if not exists raw_articles_suggest_latest_ingestion_run_idx
  on public.raw_articles (fetched_at desc, ingestion_run_id)
  where (suggestion_state is null or suggestion_state = 'new')
    and ingestion_run_id is not null;

comment on column public.raw_articles.ingestion_run_id is
  'Explicit UUID shared by raw articles inserted during one ingestion execution; null means legacy backlog.';

comment on column public.raw_articles.ingestion_source is
  'Stable ingestion source key. RSS selection prefers source_id; correspondent uses this key.';
