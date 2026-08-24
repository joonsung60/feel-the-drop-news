alter table public.articles
  add column cover_image_mode text null,
  add column cover_image_path text null;

alter table public.articles
  add constraint articles_cover_image_mode_check
  check (
    cover_image_mode is null
    or cover_image_mode in ('auto', 'none', 'custom')
  );

update storage.buckets
set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'image-sources';
