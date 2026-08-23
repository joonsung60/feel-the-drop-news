alter table public.beat_sources drop constraint beat_sources_crawl_mode_check;
alter table public.beat_sources alter column crawl_mode set default 'index';
alter table public.beat_sources add constraint beat_sources_crawl_mode_check check (crawl_mode in ('index','page'));
