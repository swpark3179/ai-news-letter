-- 0006_indexes.sql
-- 화면 쿼리 패턴에 맞춘 인덱스와 갱신 트리거.

-- 긱뉴스 : 1면 사이드바(최신 8건), 목록 화면(수집일 기준)
create index if not exists geek_news_published_at_idx
  on public.geek_news (published_at desc)
  where is_hidden = false;

create index if not exists geek_news_collected_date_idx
  on public.geek_news (collected_date desc, published_at desc);

-- 트렌드 브리핑 : 퍼온 날짜 + 출처별 조회 (1면 3열 그룹, 섹션 필터)
create index if not exists trend_items_collected_date_source_idx
  on public.trend_items (collected_date desc, source, collected_at desc)
  where status = 'published';

create index if not exists trend_items_source_variant_idx
  on public.trend_items (source, source_variant);

-- /articles/trend/<public_id> 라우트 조회
create unique index if not exists trend_items_public_id_idx
  on public.trend_items (public_id);

-- 기사 : 섹션별 최신 발행분
create index if not exists articles_section_published_idx
  on public.articles (section, published_at desc nulls last)
  where status = 'published';

create index if not exists articles_status_updated_idx
  on public.articles (status, updated_at desc);

create index if not exists articles_author_idx
  on public.articles (author_id);

create index if not exists article_sources_article_idx
  on public.article_sources (article_id, seq);

create index if not exists comments_article_idx
  on public.comments (article_id, created_at)
  where is_deleted = false;

-- 모임 / 로테이션
create index if not exists meetings_met_at_idx
  on public.meetings (met_at desc);

create index if not exists rotations_kind_period_idx
  on public.rotations (kind, period_start desc);

-- 운영
create index if not exists sync_runs_kind_started_idx
  on public.sync_runs (kind, started_at desc);

create index if not exists attachments_article_idx
  on public.attachments (article_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at 자동 갱신
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists members_touch_updated_at on public.members;
create trigger members_touch_updated_at
  before update on public.members
  for each row execute function public.touch_updated_at();

drop trigger if exists articles_touch_updated_at on public.articles;
create trigger articles_touch_updated_at
  before update on public.articles
  for each row execute function public.touch_updated_at();

drop trigger if exists app_settings_touch_updated_at on public.app_settings;
create trigger app_settings_touch_updated_at
  before update on public.app_settings
  for each row execute function public.touch_updated_at();
