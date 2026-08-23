create table public.beat_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null unique,
  crawl_mode text not null default 'item' check (crawl_mode in ('item','listing')),
  is_active boolean not null default true,
  last_crawled_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.beat_sources enable row level security;
