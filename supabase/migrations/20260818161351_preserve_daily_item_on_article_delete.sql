alter table public.daily_pipeline_items
  drop constraint daily_pipeline_items_article_id_fkey;

alter table public.daily_pipeline_items
  add constraint daily_pipeline_items_article_id_fkey
  foreign key (article_id) references public.articles(id) on delete set null;

alter table public.daily_pipeline_items
  drop constraint daily_pipeline_items_status_check;

alter table public.daily_pipeline_items
  add constraint daily_pipeline_items_status_check
  check (status = any (array['selected', 'queued', 'processing', 'done', 'failed', 'deleted']));

comment on column public.daily_pipeline_items.status is
  'Daily item lifecycle. deleted preserves display/title/job history after its draft article is deleted.';
