-- 0013_showcase.sql
-- 쇼케이스 : news.hada.io/show 수집
--
--   메인 목록(/)이 "읽을 거리"를 모으는 곳이라면 /show 는 사람들이 **직접 만든
--   것을 소개하는** 게시판이다. 목록 행 구조가 같아 열은 geek_news 와 같지만,
--   성격이 달라 테이블을 나눈다. 한 테이블에 섞으면 화면에서 「오늘의 뉴스」와
--   「누가 뭘 만들었나」를 구분할 수 없다.
--
--   PK 는 geek_news 와 같은 규칙 — 목록의 "요약부" 링크(토픽 URL)다.
--     https://news.hada.io/topic?id=32516
--   소개문 없이 올라오는 글이 있어, 그런 행은 data-topic-state-id 로 같은 형태의
--   URL 을 복원하고 summary 를 빈 문자열로 둔다 (그래서 not null default '').
--
--   published_at 은 목록 HTML 의 <time datetime="…+09:00"> 를 그대로 쓴다.

create table if not exists public.showcase_items (
  url            text primary key,

  title          text not null,
  summary        text not null default '',   -- 소개문 없는 글이 있다

  published_at   timestamptz not null,
  external_url   text,            -- 타이틀의 href (만든 것의 실제 주소)
  source_domain  text,            -- span.topicurl 의 "(my.tool)" 에서 괄호 제거
  points         integer not null default 0,
  comment_count  integer not null default 0,
  submitter      text,            -- 만든 사람

  is_hidden      boolean not null default false,

  collected_at   timestamptz not null default now(),
  collected_date date not null default (timezone('Asia/Seoul', now()))::date
);

comment on table  public.showcase_items              is 'news.hada.io/show 수집분 — 직접 만든 것 소개. PK = 요약부 링크(토픽 URL).';
comment on column public.showcase_items.url          is '요약부 a[href] 를 절대 URL 로 정규화한 값. 요약부가 없으면 토픽 id 로 복원. 중복 수집 방지 키.';
comment on column public.showcase_items.summary      is '소개문. 링크만 올린 글은 빈 문자열이다.';
comment on column public.showcase_items.external_url is '타이틀 a[href] — 만든 것의 실제 주소';
comment on column public.showcase_items.submitter    is '만든 사람 (@handle)';
comment on column public.showcase_items.published_at is '<time datetime> 속성값 (KST 오프셋 포함)';

-- ---------------------------------------------------------------------------
-- 인덱스 — geek_news 와 같은 조회 패턴(최신순 목록, 수집일 기준)
-- ---------------------------------------------------------------------------
create index if not exists showcase_items_published_at_idx
  on public.showcase_items (published_at desc)
  where is_hidden = false;

create index if not exists showcase_items_collected_date_idx
  on public.showcase_items (collected_date desc, published_at desc);

-- ---------------------------------------------------------------------------
-- RLS — 0007_rls.sql 의 방침 그대로 "켜고 정책은 두지 않는다".
--   service_role(서버)만 접근하고 anon / authenticated 는 전부 거부된다.
--   따라서 모바일 앱은 이 테이블을 직접 조회할 수 없다 (docs/SHOWCASE_QUERY.md).
-- ---------------------------------------------------------------------------
alter table public.showcase_items enable row level security;

revoke all on public.showcase_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- sync_runs.kind 에 'showcase' 를 더한다.
--
--   0005_ops.sql 이 create table 안에 인라인 CHECK 로 만든 제약이라 이름이
--   자동 생성됐다. 이름을 넘겨짚지 않고 'geeknews' 를 언급하는 CHECK 를 찾아
--   지운 뒤 다시 만든다 — 여러 번 실행해도 안전하다.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select conname
      from pg_constraint
     where conrelid = 'public.sync_runs'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) like '%geeknews%'
  loop
    execute format('alter table public.sync_runs drop constraint %I', c.conname);
  end loop;

  alter table public.sync_runs
    add constraint sync_runs_kind_check
    check (kind in ('geeknews', 'trend', 'showcase'));
end $$;

comment on column public.sync_runs.kind is 'geeknews | trend | showcase — 수집 파이프라인 종류';
