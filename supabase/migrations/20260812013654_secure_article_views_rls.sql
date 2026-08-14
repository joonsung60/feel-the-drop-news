-- Public clients only need read access for the popular-articles ranking.
-- View-count synchronization uses the server-only service role.
alter table public.article_views enable row level security;

revoke all privileges on table public.article_views
from anon, authenticated, service_role;

grant select on table public.article_views to anon;
grant select, insert, update, delete on table public.article_views to service_role;

create policy "article_views_public_read"
on public.article_views
for select
to anon
using (true);
