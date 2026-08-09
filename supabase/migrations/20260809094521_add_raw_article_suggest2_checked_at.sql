alter table public.raw_articles
  add column if not exists suggest2_last_checked_at timestamptz;

create index if not exists raw_articles_suggest2_unchecked_backlog_idx
  on public.raw_articles (origin, published_at desc nulls last, fetched_at desc, id)
  where (suggestion_state is null or suggestion_state = 'new')
    and suggest2_last_checked_at is null;
