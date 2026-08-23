alter table public.raw_articles
  add column if not exists origin text,
  add column if not exists doc_type text,
  add column if not exists event_date date,
  add column if not exists facts jsonb;

alter table public.raw_articles
  add constraint raw_articles_origin_check
  check (origin is null or origin in ('rss', 'url', 'correspondent'));

alter table public.raw_articles
  add constraint raw_articles_doc_type_check
  check (doc_type is null or doc_type in ('report', 'preview', 'recap'));

comment on column public.raw_articles.origin is '수집 경로. rss=RSS 자동수집, url=수동 URL 추가, correspondent=특파원 봇. NULL은 컬럼 도입 이전 행.';
comment on column public.raw_articles.doc_type is '소스 문서 유형. report=이미 일어난 일의 보도, preview=아직 열리지 않은 행사/발매 예고, recap=지난 행사 결산. 수확/수집 단계에서 판정.';
comment on column public.raw_articles.event_date is '행사 개최일 또는 발매일. published_at(문서 게시일)과 다른 축. preview 판정과 stale 필터의 기준값.';
comment on column public.raw_articles.facts is '소스에서 추출한 구조화 사실. lineup, venue, open_time, close_time, ticket_price, ticket_url 등. 기사 생성 시 요약문 대신 이 값을 근거로 사용.';
