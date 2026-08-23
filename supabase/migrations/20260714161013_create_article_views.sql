create table article_views (
  slug         text primary key,
  views_30d    integer not null default 0,
  updated_at   timestamptz not null default now()
);

create index article_views_views_30d_idx
  on article_views (views_30d desc);
