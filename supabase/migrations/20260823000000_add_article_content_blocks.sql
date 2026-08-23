alter table public.articles
  add column content_blocks jsonb null;

alter table public.articles
  add constraint articles_content_blocks_minimum_shape_check
  check (
    content_blocks is null
    or (
      jsonb_typeof(content_blocks) = 'object'
      and content_blocks ? 'version'
      and content_blocks->'version' = '1'::jsonb
      and content_blocks ? 'blocks'
      and jsonb_typeof(content_blocks->'blocks') = 'array'
    )
  );
