create table public.daily_pipeline_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  status text not null default 'clearing'
    check (status in ('collecting', 'clearing', 'suggesting', 'enqueueing', 'waiting', 'succeeded', 'partial', 'failed', 'timed_out')),
  ingestion_run_id uuid,
  selected_count integer not null default 0,
  success_count integer not null default 0,
  failure_count integer not null default 0,
  collect_result jsonb,
  clear_result jsonb,
  suggest_result jsonb,
  error_message text,
  runner_lock_token uuid,
  runner_lease_expires_at timestamptz,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_date)
);

create table public.daily_pipeline_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.daily_pipeline_runs(id) on delete cascade,
  suggestion_id uuid references public.suggested_clusters(id) on delete set null,
  job_id uuid references public.job_queue(id),
  article_id uuid references public.articles(id),
  selection_order integer not null check (selection_order > 0),
  display_order integer check (display_order > 0),
  suggestion_title text,
  article_title text,
  status text not null default 'selected'
    check (status in ('selected', 'queued', 'processing', 'done', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, suggestion_id),
  unique (run_id, selection_order),
  unique (job_id),
  unique (article_id)
);

alter table public.suggested_clusters
  add column if not exists daily_pipeline_run_id uuid
    references public.daily_pipeline_runs(id),
  add column if not exists daily_pipeline_selection_order integer;

create index suggested_clusters_daily_pipeline_run_idx
  on public.suggested_clusters (daily_pipeline_run_id, daily_pipeline_selection_order)
  where daily_pipeline_run_id is not null;

create unique index daily_pipeline_items_display_order_idx
  on public.daily_pipeline_items (run_id, display_order)
  where display_order is not null;

alter table public.job_queue
  add column if not exists lock_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists idempotency_key text;

-- The legacy worker had no lease columns. Requeue only orphaned legacy
-- processing rows so they can be claimed by the lease-aware worker.
update public.job_queue
set status = 'pending',
    updated_at = now()
where status = 'processing'
  and lock_token is null
  and lease_expires_at is null;

drop index if exists public.job_queue_generate_suggestion_idempotency_idx;

create unique index job_queue_idempotency_key_idx
  on public.job_queue (idempotency_key)
  where idempotency_key is not null;

alter table public.articles
  add column if not exists generation_key text;

create unique index articles_generation_key_idx
  on public.articles (generation_key)
  where generation_key is not null;

create unique index suggested_clusters_daily_pipeline_order_uidx
  on public.suggested_clusters (daily_pipeline_run_id, daily_pipeline_selection_order)
  where daily_pipeline_run_id is not null;

create index daily_pipeline_runs_active_idx
  on public.daily_pipeline_runs (run_date desc, created_at desc)
  where status in ('collecting', 'clearing', 'suggesting', 'enqueueing', 'waiting');

create index daily_pipeline_items_run_status_idx
  on public.daily_pipeline_items (run_id, status, selection_order);

create index daily_pipeline_items_suggestion_id_idx
  on public.daily_pipeline_items (suggestion_id)
  where suggestion_id is not null;

create or replace function public.acquire_daily_pipeline_run(
  requested_run_date date,
  requested_lock_token uuid,
  requested_lease_seconds integer default 14400,
  allow_terminal_retry boolean default false
)
returns setof public.daily_pipeline_runs
language plpgsql
security invoker
set search_path = public
as $$
declare
  acquired public.daily_pipeline_runs;
begin
  insert into public.daily_pipeline_runs (
    run_date,
    runner_lock_token,
    runner_lease_expires_at
  ) values (
    requested_run_date,
    requested_lock_token,
    now() + make_interval(secs => requested_lease_seconds)
  )
  on conflict (run_date) do update
  set status = case
        when daily_pipeline_runs.clear_result is null then 'clearing'
        when daily_pipeline_runs.collect_result is null then 'collecting'
        when daily_pipeline_runs.suggest_result is null then 'suggesting'
        else 'enqueueing'
      end,
      runner_lock_token = excluded.runner_lock_token,
      runner_lease_expires_at = excluded.runner_lease_expires_at,
      error_message = null,
      completed_at = null,
      updated_at = now()
  where (
      daily_pipeline_runs.status in ('collecting', 'clearing', 'suggesting', 'enqueueing', 'waiting')
      and daily_pipeline_runs.runner_lease_expires_at < now()
    ) or (
      allow_terminal_retry
      and daily_pipeline_runs.status in ('failed', 'timed_out')
    )
  returning * into acquired;

  if acquired.id is not null then
    return next acquired;
  end if;
end;
$$;

create or replace function public.clear_pending_suggested_clusters()
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  deleted_count integer := 0;
  reset_count integer := 0;
begin
  select count(*) into deleted_count
  from public.suggested_clusters
  where status = 'pending';

  update public.raw_articles
  set suggestion_state = 'new',
      suggestion_last_checked_at = null
  where id::text in (
    select distinct unnest(article_ids)
    from public.suggested_clusters
    where status = 'pending'
      and article_ids is not null
  );
  get diagnostics reset_count = row_count;

  delete from public.suggested_clusters
  where status = 'pending';

  return jsonb_build_object(
    'success', true,
    'deleted', deleted_count,
    'resetRawArticles', reset_count,
    'rawArticleResetError', null
  );
end;
$$;

create or replace function public.ensure_suggestion_cluster(
  requested_suggestion_id uuid,
  requested_topic text,
  requested_keywords text[],
  requested_article_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  existing_cluster_id uuid;
  created_cluster_id uuid;
begin
  select cluster_id into existing_cluster_id
  from public.suggested_clusters
  where id = requested_suggestion_id
  for update;

  if not found then
    raise exception 'suggestion not found: %', requested_suggestion_id;
  end if;
  if existing_cluster_id is not null then
    return existing_cluster_id;
  end if;

  insert into public.article_clusters (topic, keywords)
  values (requested_topic, requested_keywords)
  returning id into created_cluster_id;

  insert into public.cluster_articles (cluster_id, raw_article_id)
  select created_cluster_id, article_id
  from unnest(requested_article_ids) as article_id
  on conflict do nothing;

  update public.suggested_clusters
  set cluster_id = created_cluster_id,
      status = 'approved'
  where id = requested_suggestion_id;

  return created_cluster_id;
end;
$$;

create or replace function public.publish_article_batch(requested_articles jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  entry jsonb;
  current_article record;
  published_at_value timestamptz := now();
  requested_count integer;
  distinct_count integer;
  published_rows jsonb;
begin
  if jsonb_typeof(requested_articles) <> 'array' then
    raise exception 'requested_articles must be a JSON array';
  end if;

  requested_count := jsonb_array_length(requested_articles);
  if requested_count = 0 then
    raise exception 'requested_articles must not be empty';
  end if;

  select count(distinct (value ->> 'id')) into distinct_count
  from jsonb_array_elements(requested_articles);
  if distinct_count <> requested_count then
    raise exception 'duplicate article id';
  end if;

  perform 1
  from public.articles article
  join jsonb_array_elements(requested_articles) requested
    on article.id = (requested.value ->> 'id')::uuid
  order by article.id
  for update of article;

  for entry in select value from jsonb_array_elements(requested_articles)
  loop
    select id, published, updated_at into current_article
    from public.articles
    where id = (entry ->> 'id')::uuid;

    if not found then
      raise exception 'article not found: %', entry ->> 'id';
    end if;
    if current_article.published then
      raise exception 'article already published: %', current_article.id;
    end if;
    if current_article.updated_at is distinct from (entry ->> 'updated_at')::timestamptz then
      raise exception 'article changed during publish: %', current_article.id;
    end if;
  end loop;

  update public.articles article
  set published = true,
      published_at = published_at_value
  where article.id in (
    select (value ->> 'id')::uuid
    from jsonb_array_elements(requested_articles)
  );

  update public.raw_articles raw
  set suggestion_state = 'used',
      suggestion_used_at = published_at_value
  where raw.id in (
    select distinct link.raw_article_id
    from public.cluster_articles link
    join public.articles article on article.cluster_id = link.cluster_id
    where article.id in (
      select (value ->> 'id')::uuid
      from jsonb_array_elements(requested_articles)
    )
  );

  select jsonb_agg(to_jsonb(article) order by requested.ordinality)
  into published_rows
  from jsonb_array_elements(requested_articles) with ordinality requested(value, ordinality)
  join public.articles article on article.id = (requested.value ->> 'id')::uuid;

  return coalesce(published_rows, '[]'::jsonb);
end;
$$;

drop function if exists public.claim_pending_job();

create or replace function public.claim_pending_job(
  requested_lock_token uuid,
  requested_lease_seconds integer default 900
)
returns setof public.job_queue
language sql
security invoker
set search_path = public
as $$
  update public.job_queue
  set status = 'processing',
      lock_token = requested_lock_token,
      lease_expires_at = now() + make_interval(secs => requested_lease_seconds),
      attempt_count = attempt_count + 1,
      updated_at = now()
  where id = (
    select id
    from public.job_queue
    where status = 'pending'
       or (status = 'processing' and lease_expires_at < now())
    order by created_at asc
    limit 1
    for update skip locked
  )
  returning *;
$$;

alter table public.daily_pipeline_runs enable row level security;
alter table public.daily_pipeline_items enable row level security;

revoke all on table public.daily_pipeline_runs from anon, authenticated;
revoke all on table public.daily_pipeline_items from anon, authenticated;
revoke execute on function public.acquire_daily_pipeline_run(date, uuid, integer, boolean) from public, anon, authenticated;
revoke execute on function public.claim_pending_job(uuid, integer) from public, anon, authenticated;
revoke execute on function public.clear_pending_suggested_clusters() from public, anon, authenticated;
revoke execute on function public.ensure_suggestion_cluster(uuid, text, text[], uuid[]) from public, anon, authenticated;
revoke execute on function public.publish_article_batch(jsonb) from public, anon, authenticated;
grant all on table public.daily_pipeline_runs to service_role;
grant all on table public.daily_pipeline_items to service_role;
grant execute on function public.acquire_daily_pipeline_run(date, uuid, integer, boolean) to service_role;
grant execute on function public.claim_pending_job(uuid, integer) to service_role;
grant execute on function public.clear_pending_suggested_clusters() to service_role;
grant execute on function public.ensure_suggestion_cluster(uuid, text, text[], uuid[]) to service_role;
grant execute on function public.publish_article_batch(jsonb) to service_role;

comment on column public.daily_pipeline_items.selection_order is
  'Rank order selected from the current Suggest 1 response, including failed jobs.';
comment on column public.daily_pipeline_items.display_order is
  'Compact 1..N order assigned by the runner only to successful draft results.';
