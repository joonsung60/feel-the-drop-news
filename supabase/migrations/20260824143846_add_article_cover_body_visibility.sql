alter table public.articles
  add column show_cover_in_article boolean null;

comment on column public.articles.show_cover_in_article is
  'NULL/true keeps the cover at the top of the article; false uses it only outside the article body.';
