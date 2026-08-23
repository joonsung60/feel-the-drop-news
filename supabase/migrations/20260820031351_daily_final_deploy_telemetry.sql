alter table public.daily_pipeline_runs
  add column deploy_status text not null default 'pending',
  add column deploy_claim_token uuid,
  add column deploy_claimed_at timestamptz,
  add column deploy_completed_at timestamptz,
  add column deploy_attempt_count integer not null default 0,
  add column deploy_error text;

alter table public.daily_pipeline_runs
  add constraint daily_pipeline_runs_deploy_status_check
  check (deploy_status = any (array['pending', 'claimed', 'succeeded', 'failed']));

alter table public.daily_pipeline_items
  drop constraint daily_pipeline_items_status_check;

alter table public.daily_pipeline_items
  add constraint daily_pipeline_items_status_check
  check (status = any (array['selected', 'queued', 'processing', 'done', 'failed', 'deleted', 'published']));

create or replace function public.publish_daily_article_batch(
  requested_run_id uuid,
  requested_display_orders integer[],
  requested_articles jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  requested_count integer;
  matched_count integer;
  invalid_count integer;
  published_rows jsonb;
begin
  if jsonb_typeof(requested_articles) <> 'array' then
    raise exception 'requested_articles must be a JSON array';
  end if;
  requested_count := jsonb_array_length(requested_articles);
  if requested_count = 0 or cardinality(requested_display_orders) <> requested_count then
    raise exception 'daily publish request sizes do not match';
  end if;
  if (select count(distinct value) from unnest(requested_display_orders) value) <> requested_count then
    raise exception 'duplicate display order';
  end if;

  perform 1
  from public.daily_pipeline_items item
  where item.run_id = requested_run_id
    and item.display_order = any(requested_display_orders)
  order by item.id
  for update;

  select count(*) into matched_count
  from public.daily_pipeline_items item
  where item.run_id = requested_run_id
    and item.display_order = any(requested_display_orders);
  if matched_count <> requested_count then
    raise exception 'daily item not found';
  end if;

  select count(*) into invalid_count
  from jsonb_array_elements(requested_articles) with ordinality requested(value, ordinality)
  left join public.daily_pipeline_items item
    on item.run_id = requested_run_id
   and item.display_order = requested_display_orders[requested.ordinality::integer]
  where item.status <> 'done'
     or item.article_id is distinct from (requested.value ->> 'id')::uuid;
  if invalid_count <> 0 then
    raise exception 'daily item is no longer publishable';
  end if;

  select public.publish_article_batch(requested_articles) into published_rows;

  update public.daily_pipeline_items
  set status = 'published',
      updated_at = now()
  where run_id = requested_run_id
    and display_order = any(requested_display_orders)
    and status = 'done';

  return published_rows;
end;
$$;

create or replace function public.claim_daily_pipeline_deploy(
  requested_run_id uuid,
  requested_claim_token uuid,
  allow_failed_retry boolean default false
)
returns table (run_id uuid, claim_token uuid, deploy_status text)
language sql
security invoker
set search_path = public
as $$
  update public.daily_pipeline_runs run
  set deploy_status = 'claimed',
      deploy_claim_token = requested_claim_token,
      deploy_claimed_at = now(),
      deploy_completed_at = null,
      deploy_error = null,
      deploy_attempt_count = deploy_attempt_count + 1,
      updated_at = now()
  where run.id = requested_run_id
    and run.status in ('succeeded', 'partial')
    and (
      run.deploy_status = 'pending'
      or (
        allow_failed_retry
        and (
          run.deploy_status = 'failed'
          or (run.deploy_status = 'claimed' and run.deploy_claimed_at < now() - interval '15 minutes')
        )
      )
    )
    and run.selected_count = (
      select count(*) from public.daily_pipeline_items item where item.run_id = run.id
    )
    and not exists (
      select 1
      from public.daily_pipeline_items item
      where item.run_id = run.id
        and item.status not in ('published', 'deleted', 'failed')
    )
  returning run.id, run.deploy_claim_token, run.deploy_status;
$$;

create or replace function public.record_daily_pipeline_deploy(
  requested_run_id uuid,
  requested_claim_token uuid,
  requested_success boolean,
  requested_error text default null
)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  updated_count integer;
begin
  update public.daily_pipeline_runs
  set deploy_status = case when requested_success then 'succeeded' else 'failed' end,
      deploy_completed_at = now(),
      deploy_error = case when requested_success then null else left(coalesce(requested_error, 'unknown deploy error'), 2000) end,
      updated_at = now()
  where id = requested_run_id
    and deploy_status = 'claimed'
    and deploy_claim_token = requested_claim_token;
  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

revoke execute on function public.publish_daily_article_batch(uuid, integer[], jsonb) from public, anon, authenticated;
revoke execute on function public.claim_daily_pipeline_deploy(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function public.record_daily_pipeline_deploy(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.publish_daily_article_batch(uuid, integer[], jsonb) to service_role;
grant execute on function public.claim_daily_pipeline_deploy(uuid, uuid, boolean) to service_role;
grant execute on function public.record_daily_pipeline_deploy(uuid, uuid, boolean, text) to service_role;

comment on column public.daily_pipeline_runs.deploy_status is
  'Per-run final Cloudflare deploy lifecycle. Only the atomic claim RPC may move pending/failed to claimed.';
comment on column public.daily_pipeline_items.status is
  'Generation and editorial lifecycle. published/deleted are terminal editorial decisions.';
