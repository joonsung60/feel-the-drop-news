create table public.homepage_placements (
  placement text primary key,
  article_id uuid references public.articles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint homepage_placements_supported_placement_check
    check (placement in ('homepage_hero'))
);

comment on table public.homepage_placements is
  'Typed editorial placements for the public homepage.';
comment on column public.homepage_placements.article_id is
  'A null article_id enables automatic latest-article selection.';

insert into public.homepage_placements (placement, article_id)
values ('homepage_hero', null);

alter table public.homepage_placements enable row level security;

revoke all on table public.homepage_placements from public, anon, authenticated, service_role;
grant select on table public.homepage_placements to anon;
grant select, update on table public.homepage_placements to service_role;

create policy homepage_placements_anon_select
on public.homepage_placements
for select
to anon
using (true);

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
declare
  target_published boolean;
  current_article_id uuid;
  current_updated_at timestamptz;
begin
  -- Lock article first. The unpublish trigger takes locks in the same order.
  if requested_article_id is not null then
    select article.published
    into target_published
    from public.articles article
    where article.id = requested_article_id
    for share;

    if not found then
      return query select 'article_not_found'::text, null::uuid, false, null::timestamptz;
      return;
    end if;

    if target_published is not true then
      return query select 'article_unpublished'::text, null::uuid, false, null::timestamptz;
      return;
    end if;
  end if;

  select placement.article_id, placement.updated_at
  into current_article_id, current_updated_at
  from public.homepage_placements placement
  where placement.placement = 'homepage_hero'
  for update;

  if not found then
    raise exception 'homepage_hero placement row is missing'
      using errcode = 'P0001';
  end if;

  if current_article_id is not distinct from requested_article_id then
    return query select 'unchanged'::text, current_article_id, false, current_updated_at;
    return;
  end if;

  update public.homepage_placements placement
  set article_id = requested_article_id,
      updated_at = now()
  where placement.placement = 'homepage_hero'
  returning placement.article_id, placement.updated_at
  into current_article_id, current_updated_at;

  return query select 'updated'::text, current_article_id, true, current_updated_at;
end;
$$;

revoke execute on function public.set_homepage_hero(uuid) from public, anon, authenticated;
grant execute on function public.set_homepage_hero(uuid) to service_role;

create or replace function public.clear_homepage_hero_on_article_unpublish()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.published is true and new.published is false then
    update public.homepage_placements placement
    set article_id = null,
        updated_at = now()
    where placement.placement = 'homepage_hero'
      and placement.article_id = new.id;
  end if;

  return new;
end;
$$;

revoke execute on function public.clear_homepage_hero_on_article_unpublish()
  from public, anon, authenticated, service_role;

create trigger articles_clear_homepage_hero_on_unpublish
after update of published on public.articles
for each row
when (old.published is true and new.published is false)
execute function public.clear_homepage_hero_on_article_unpublish();
