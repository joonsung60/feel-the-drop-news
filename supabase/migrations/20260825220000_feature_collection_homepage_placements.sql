create table public.article_features (
  article_id uuid primary key
    references public.articles(id) on delete cascade,
  featured_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index article_features_featured_at_article_id_idx
on public.article_features (featured_at desc, article_id asc);

alter table public.article_features enable row level security;

revoke all on table public.article_features from public, anon, authenticated, service_role;
grant select on table public.article_features to anon;
-- UPDATE is required by SELECT ... FOR UPDATE/SHARE in the invoker RPCs.
grant select, insert, update, delete on table public.article_features to service_role;

create policy article_features_anon_select
on public.article_features
for select
to anon
using (true);

-- Preserve the effective public Hero before placements become Feature-only.
insert into public.article_features (article_id, featured_at, updated_at)
select hp.article_id, coalesce(hp.updated_at, now()), now()
from public.homepage_placements hp
join public.articles article on article.id = hp.article_id
where hp.placement = 'homepage_hero'
  and hp.article_id is not null
  and article.published is true
on conflict (article_id) do nothing;

alter table public.homepage_placements
  drop constraint homepage_placements_supported_placement_check;

alter table public.homepage_placements
  add constraint homepage_placements_supported_placement_check
  check (placement in (
    'homepage_hero',
    'homepage_featured_1',
    'homepage_featured_2',
    'homepage_featured_3'
  ));

insert into public.homepage_placements (placement, article_id)
values
  ('homepage_hero', null),
  ('homepage_featured_1', null),
  ('homepage_featured_2', null),
  ('homepage_featured_3', null)
on conflict (placement) do nothing;

alter table public.homepage_placements
  drop constraint homepage_placements_article_id_fkey;

alter table public.homepage_placements
  add constraint homepage_placements_article_id_fkey
  foreign key (article_id)
  references public.article_features(article_id)
  on delete set null;

alter table public.homepage_placements
  add constraint homepage_placements_article_id_key unique (article_id);

create or replace function public.set_article_feature(
  requested_article_id uuid,
  requested_placement text default null
)
returns table (
  result text,
  article_id uuid,
  featured_at timestamptz,
  placement text,
  changed boolean,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_published boolean;
  feature_time timestamptz;
  feature_changed boolean := false;
  placement_changed boolean := false;
  placement_count integer;
  placement_time timestamptz;
begin
  if requested_placement is not null and requested_placement not in (
    'homepage_hero', 'homepage_featured_1',
    'homepage_featured_2', 'homepage_featured_3'
  ) then
    raise exception 'unsupported homepage placement: %', requested_placement
      using errcode = '22023';
  end if;

  select article.published into target_published
  from public.articles article
  where article.id = requested_article_id
  for share;

  if not found then
    return query select 'article_not_found'::text, requested_article_id,
      null::timestamptz, requested_placement, false, null::timestamptz;
    return;
  end if;
  if target_published is not true then
    return query select 'article_unpublished'::text, requested_article_id,
      null::timestamptz, requested_placement, false, null::timestamptz;
    return;
  end if;

  perform 1 from public.article_features feature
  where feature.article_id = requested_article_id
  for update;

  perform 1 from public.homepage_placements hp
  order by hp.placement
  for update;
  get diagnostics placement_count = row_count;
  if placement_count <> 4 then
    raise exception 'homepage placement singleton rows are missing'
      using errcode = 'P0001';
  end if;

  insert into public.article_features (article_id)
  values (requested_article_id)
  on conflict on constraint article_features_pkey do nothing;
  get diagnostics placement_count = row_count;
  feature_changed := placement_count = 1;

  select feature.featured_at into feature_time
  from public.article_features feature
  where feature.article_id = requested_article_id;

  if requested_placement is not null then
    if not exists (
      select 1 from public.homepage_placements hp
      where hp.placement = requested_placement
        and hp.article_id = requested_article_id
    ) then
      update public.homepage_placements hp
      set article_id = null, updated_at = now()
      where hp.article_id = requested_article_id
         or (hp.placement = requested_placement and hp.article_id is not null);

      update public.homepage_placements hp
      set article_id = requested_article_id, updated_at = now()
      where hp.placement = requested_placement
      returning hp.updated_at into placement_time;
      placement_changed := true;
    else
      select hp.updated_at into placement_time
      from public.homepage_placements hp
      where hp.placement = requested_placement;
    end if;
  end if;

  return query select
    case when feature_changed or placement_changed then 'updated' else 'unchanged' end,
    requested_article_id, feature_time, requested_placement,
    feature_changed or placement_changed,
    coalesce(placement_time, feature_time);
end;
$$;

create or replace function public.remove_article_feature(requested_article_id uuid)
returns table (
  result text,
  article_id uuid,
  changed boolean,
  cleared_placements text[]
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_exists boolean;
  placement_count integer;
  cleared text[];
  deleted_count integer;
begin
  select true into target_exists
  from public.articles article
  where article.id = requested_article_id
  for share;
  if not found then
    return query select 'article_not_found'::text, requested_article_id, false, array[]::text[];
    return;
  end if;

  perform 1 from public.article_features feature
  where feature.article_id = requested_article_id
  for update;

  perform 1 from public.homepage_placements hp
  order by hp.placement
  for update;
  get diagnostics placement_count = row_count;
  if placement_count <> 4 then
    raise exception 'homepage placement singleton rows are missing'
      using errcode = 'P0001';
  end if;

  select coalesce(array_agg(hp.placement order by hp.placement), array[]::text[])
  into cleared
  from public.homepage_placements hp
  where hp.article_id = requested_article_id;

  delete from public.article_features feature
  where feature.article_id = requested_article_id;
  get diagnostics deleted_count = row_count;

  return query select
    case when deleted_count = 1 then 'updated' else 'unchanged' end,
    requested_article_id, deleted_count = 1, cleared;
end;
$$;

create or replace function public.set_homepage_placement(
  requested_placement text,
  requested_article_id uuid
)
returns table (
  result text,
  article_id uuid,
  placement text,
  changed boolean,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_published boolean;
  target_featured boolean;
  placement_count integer;
  placement_time timestamptz;
begin
  if requested_placement not in (
    'homepage_hero', 'homepage_featured_1',
    'homepage_featured_2', 'homepage_featured_3'
  ) then
    raise exception 'unsupported homepage placement: %', requested_placement
      using errcode = '22023';
  end if;

  select article.published into target_published
  from public.articles article
  where article.id = requested_article_id
  for share;
  if not found then
    return query select 'article_not_found'::text, requested_article_id,
      requested_placement, false, null::timestamptz;
    return;
  end if;
  if target_published is not true then
    return query select 'article_unpublished'::text, requested_article_id,
      requested_placement, false, null::timestamptz;
    return;
  end if;

  select true into target_featured
  from public.article_features feature
  where feature.article_id = requested_article_id
  for share;
  if not found then
    return query select 'article_not_featured'::text, requested_article_id,
      requested_placement, false, null::timestamptz;
    return;
  end if;

  perform 1 from public.homepage_placements hp
  order by hp.placement
  for update;
  get diagnostics placement_count = row_count;
  if placement_count <> 4 then
    raise exception 'homepage placement singleton rows are missing'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1 from public.homepage_placements hp
    where hp.placement = requested_placement
      and hp.article_id = requested_article_id
  ) then
    select hp.updated_at into placement_time
    from public.homepage_placements hp
    where hp.placement = requested_placement;
    return query select 'unchanged'::text, requested_article_id,
      requested_placement, false, placement_time;
    return;
  end if;

  update public.homepage_placements hp
  set article_id = null, updated_at = now()
  where hp.article_id = requested_article_id
     or (hp.placement = requested_placement and hp.article_id is not null);

  update public.homepage_placements hp
  set article_id = requested_article_id, updated_at = now()
  where hp.placement = requested_placement
  returning hp.updated_at into placement_time;

  return query select 'updated'::text, requested_article_id,
    requested_placement, true, placement_time;
end;
$$;

create or replace function public.clear_homepage_placement(requested_placement text)
returns table (
  result text,
  article_id uuid,
  placement text,
  changed boolean,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_article_id uuid;
  current_updated_at timestamptz;
begin
  if requested_placement not in (
    'homepage_hero', 'homepage_featured_1',
    'homepage_featured_2', 'homepage_featured_3'
  ) then
    raise exception 'unsupported homepage placement: %', requested_placement
      using errcode = '22023';
  end if;

  select hp.article_id, hp.updated_at
  into current_article_id, current_updated_at
  from public.homepage_placements hp
  where hp.placement = requested_placement
  for update;
  if not found then
    raise exception 'homepage placement singleton row is missing: %', requested_placement
      using errcode = 'P0001';
  end if;

  if current_article_id is null then
    return query select 'unchanged'::text, null::uuid,
      requested_placement, false, current_updated_at;
    return;
  end if;

  update public.homepage_placements hp
  set article_id = null, updated_at = now()
  where hp.placement = requested_placement
  returning hp.updated_at into current_updated_at;

  return query select 'updated'::text, null::uuid,
    requested_placement, true, current_updated_at;
end;
$$;

-- Keep the Hero V1 runtime compatible during migration rollout.
create or replace function public.set_homepage_hero(requested_article_id uuid)
returns table (
  result text,
  article_id uuid,
  changed boolean,
  updated_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
begin
  if requested_article_id is null then
    return query
    select mutation.result, mutation.article_id, mutation.changed, mutation.updated_at
    from public.clear_homepage_placement('homepage_hero') mutation;
  else
    return query
    select mutation.result, mutation.article_id, mutation.changed, mutation.updated_at
    from public.set_article_feature(requested_article_id, 'homepage_hero') mutation;
  end if;
end;
$$;

create or replace function public.clear_homepage_hero_on_article_unpublish()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.published is true and new.published is false then
    delete from public.article_features feature
    where feature.article_id = new.id;
  end if;
  return new;
end;
$$;

revoke execute on function public.set_article_feature(uuid, text)
  from public, anon, authenticated;
revoke execute on function public.remove_article_feature(uuid)
  from public, anon, authenticated;
revoke execute on function public.set_homepage_placement(text, uuid)
  from public, anon, authenticated;
revoke execute on function public.clear_homepage_placement(text)
  from public, anon, authenticated;
revoke execute on function public.set_homepage_hero(uuid)
  from public, anon, authenticated;
revoke execute on function public.clear_homepage_hero_on_article_unpublish()
  from public, anon, authenticated, service_role;

grant execute on function public.set_article_feature(uuid, text) to service_role;
grant execute on function public.remove_article_feature(uuid) to service_role;
grant execute on function public.set_homepage_placement(text, uuid) to service_role;
grant execute on function public.clear_homepage_placement(text) to service_role;
grant execute on function public.set_homepage_hero(uuid) to service_role;
