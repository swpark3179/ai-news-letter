-- =============================================================================
-- AI 뉴스레터 — 전체 스키마 (통합본)
--
-- supabase/migrations/ 의 SQL 을 번호 순서대로 이어 붙인 것입니다.
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 한 번에 Run 하세요.
--
-- 전부 `if not exists` / `on conflict do nothing` 이라 여러 번 실행해도 안전합니다.
-- 이 파일은 생성물입니다. 스키마를 고칠 때는 migrations/ 의 개별 파일을 고치고
-- npm run sql:bundle 로 다시 만드세요.
-- =============================================================================

-- ===========================================================================
-- 0001_extensions.sql
-- ===========================================================================

-- 0001_extensions.sql
-- gen_random_uuid() 를 쓰기 위한 확장. Supabase 프로젝트에는 보통 이미 켜져 있다.

create extension if not exists pgcrypto with schema extensions;

-- ===========================================================================
-- 0002_core.sql
-- ===========================================================================

-- 0002_core.sql
-- 구성원과 애플리케이션 설정.

-- ---------------------------------------------------------------------------
-- members : 유닛원 + 구독자
--   사내 SSO 로 들어온 사번(emp_no)이 자연 키. Supabase Auth 는 사용하지 않는다.
-- ---------------------------------------------------------------------------
create table if not exists public.members (
  id          uuid primary key default gen_random_uuid(),
  emp_no      text unique not null,
  name        text not null,
  email       text unique,
  dept        text,

  -- unit_lead : Unit 장 / member : 유닛원 / subscriber : 부서 구독자
  role        text not null default 'subscriber'
              check (role in ('unit_lead', 'member', 'subscriber')),
  is_admin    boolean not null default false,

  -- 아바타 표시용. 디자인의 AV 맵(1364~1369행)에 대응한다.
  initial     text,                                   -- '세원'
  avatar_tone text not null default 'gray'
              check (avatar_tone in ('purple', 'blue', 'green', 'yellow', 'gray')),

  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table  public.members       is '유닛원·구독자. 사내 SSO 사번이 자연 키.';
comment on column public.members.role  is 'unit_lead | member | subscriber';
comment on column public.members.avatar_tone is '아바타 배경/글자색 팔레트 선택자';

-- ---------------------------------------------------------------------------
-- app_settings : 디자인의 props 3종(issueNo / publisher / showEnSubtitles) 등
--                운영 중 바뀌는 단순 설정을 key-value 로 보관
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.app_settings is '발행 정보 등 런타임 설정 (issue_no, publisher, show_en_subtitles ...)';

-- ===========================================================================
-- 0003_content.sql
-- ===========================================================================

-- 0003_content.sql
-- 네 개 카테고리의 콘텐츠 테이블.
--   긱뉴스 데일리   -> geek_news    (자동 수집, LLM 미사용)
--   트렌드 브리핑   -> trend_items  (자동 수집 + LLM 기사 작성)
--   위클리 리뷰     -> articles (section='review')
--   심층 분석       -> articles (section='deep')

-- ---------------------------------------------------------------------------
-- geek_news : news.hada.io 수집
--
--   PK 는 목록의 "요약부" 링크 URL 이다. 타이틀 href(원문 사이트)가 아니라
--   긱뉴스 내부 토픽 URL 이므로 안정적이고, 재동기화 시 기존 항목을 자연스럽게
--   건너뛸 수 있다.
--     일반 토픽      https://news.hada.io/topic?id=32516
--     긱뉴스 자체글  https://news.hada.io/article/<slug>   (ARTICLE 배지가 붙은 행)
--
--   published_at 은 목록 HTML 의 <time datetime="2026-08-21T01:13:20+09:00"> 를
--   그대로 쓴다. "n일전" 문구를 역산할 필요가 없다.
-- ---------------------------------------------------------------------------
create table if not exists public.geek_news (
  url            text primary key,

  title          text not null,
  summary        text not null,

  published_at   timestamptz not null,
  external_url   text,            -- 타이틀의 href (원문 사이트)
  source_domain  text,            -- span.topicurl 의 "(runjs.app)" 에서 괄호 제거
  points         integer not null default 0,
  comment_count  integer not null default 0,
  submitter      text,            -- '@kciter1' 또는 'GeekNews'

  is_hidden      boolean not null default false,

  collected_at   timestamptz not null default now(),
  collected_date date not null default (timezone('Asia/Seoul', now()))::date
);

comment on table  public.geek_news              is 'news.hada.io 수집분. PK = 요약부 링크(토픽 URL).';
comment on column public.geek_news.url          is '요약부 a[href] 를 절대 URL 로 정규화한 값. 중복 수집 방지 키.';
comment on column public.geek_news.external_url is '타이틀 a[href] — 실제 원문 사이트 주소';
comment on column public.geek_news.published_at is '<time datetime> 속성값 (KST 오프셋 포함)';

-- ---------------------------------------------------------------------------
-- trend_items : 트렌드 브리핑
--
--   PK 는 원본 URL. GitHub Trending 은 daily/weekly/monthly 를 각각 조회해
--   합집합으로 모으므로, 같은 저장소가 여러 기간에 걸쳐도 URL 로 중복 제거된다.
--
--   작성일이 불명확한 출처가 섞여 있어 조회 기준은 collected_date(퍼온 날짜)다.
-- ---------------------------------------------------------------------------
create table if not exists public.trend_items (
  source_url     text primary key,

  -- URL 을 그대로 라우트에 쓸 수 없으므로 결정적 짧은 식별자를 파생시킨다.
  -- /articles/trend/<public_id> 로 접근한다. 값이 source_url 에서 계산되므로
  -- 별도 저장 로직이 없고 재동기화해도 같은 주소를 유지한다.
  public_id      text generated always as (substr(md5(source_url), 1, 12)) stored,

  source         text not null
                 check (source in ('github', 'hn', 'arxiv', 'geeknews')),
  -- github: daily|weekly|monthly / arxiv: cs.AI|cs.CL|cs.IR / hn: top
  source_variant text,

  -- 수집 원문 (AI 가 읽은 재료 — 재생성/감사 목적으로 보관)
  raw_title      text,
  raw_excerpt    text,
  -- {stars, stars_in_period, language, points, comments, arxiv_id, authors, ...}
  metrics        jsonb not null default '{}'::jsonb,

  -- AI 생성 결과
  title          text not null,
  deck           text,
  -- [{ "type": "text" | "head" | "quote", "t": "..." }]
  body           jsonb not null default '[]'::jsonb,
  tags           text[] not null default '{}',

  llm_provider   text check (llm_provider in ('gemini', 'openai')),
  llm_model      text,

  status         text not null default 'published'
                 check (status in ('published', 'review', 'hidden')),

  view_count     integer not null default 0,

  collected_at   timestamptz not null default now(),
  collected_date date not null default (timezone('Asia/Seoul', now()))::date
);

comment on table  public.trend_items                is 'GitHub Trending · HN · arXiv · 긱뉴스를 AI 가 한국어 기사로 요약한 결과. PK = 원본 URL.';
comment on column public.trend_items.source_variant is 'github 은 daily/weekly/monthly, arxiv 는 카테고리';
comment on column public.trend_items.collected_date is '퍼온 날짜(KST). 원문 작성일이 불명확해 이 값으로 조회한다.';
comment on column public.trend_items.body           is '블록 배열 [{type:text|head|quote, t}]';

-- ---------------------------------------------------------------------------
-- articles : 유닛원이 직접 쓰는 글 (위클리 리뷰 / 심층 분석)
-- ---------------------------------------------------------------------------
create table if not exists public.articles (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique,

  section      text not null check (section in ('review', 'deep')),
  title        text not null,
  deck         text,
  body         jsonb not null default '[]'::jsonb,   -- trend_items.body 와 동일 구조
  tags         text[] not null default '{}',

  -- 위클리 리뷰 카드에 표시되는 저장소/출처 라벨 (예: 'github.com/vllm-project/vllm')
  repo_label   text,

  author_id    uuid references public.members (id) on delete set null,

  status       text not null default 'draft'
               check (status in ('draft', 'review', 'published')),
  published_at timestamptz,
  issue_no     integer,

  -- 심층 분석 전용 (월 1회 정기 발표)
  talk_date    timestamptz,
  talk_room    text,
  photo_path   text,          -- Supabase Storage 오브젝트 경로

  read_minutes integer,
  view_count   integer not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table  public.articles         is '유닛원 작성 글. section=review(위클리 리뷰) | deep(심층 분석)';
comment on column public.articles.body    is '블록 배열 [{type:text|head|quote, t}]';
comment on column public.articles.repo_label is '위클리 리뷰 카드 상단의 저장소/출처 라벨';

-- ---------------------------------------------------------------------------
-- article_sources : 기사 우측 "원문 소스" 카드
-- ---------------------------------------------------------------------------
create table if not exists public.article_sources (
  id         bigint generated always as identity primary key,
  article_id uuid not null references public.articles (id) on delete cascade,
  kind       text not null check (kind in ('gh', 'hn', 'ax', 'gk')),
  label      text,
  url        text not null,
  seq        integer not null default 0
);

comment on column public.article_sources.kind is 'gh=GITHUB, hn=HN, ax=ARXIV, gk=GEEKNEWS — 디자인의 SRC 맵과 동일';

-- ---------------------------------------------------------------------------
-- comments : 심층 분석 기사의 토론 코멘트
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  article_id  uuid not null references public.articles (id) on delete cascade,
  member_id   uuid references public.members (id) on delete set null,

  -- member 가 지워져도 표시가 유지되도록 작성 시점 값을 복사해 둔다
  author_name text not null,
  role_tag    text not null default '유닛원',

  body        text not null,
  is_deleted  boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on column public.comments.role_tag is '유닛원 | 구독자 | Unit 장 — 배지 텍스트';

-- ===========================================================================
-- 0004_unit.sql
-- ===========================================================================

-- 0004_unit.sql
-- 유닛 운영 데이터 : 모임 아카이브, 발표/당번 로테이션, 스크랩.

-- ---------------------------------------------------------------------------
-- meetings : 매주 정기 모임 (디자인 MEETINGS, 1624~1643행)
-- ---------------------------------------------------------------------------
create table if not exists public.meetings (
  id           uuid primary key default gen_random_uuid(),
  week_label   text not null,                 -- '8월 3주차'
  met_at       timestamptz not null,
  room         text,                          -- '판교 A동 회의실 4' / '온라인 (Teams)'

  -- ['에이전트 런타임 트렌드 — 사내망 프록시 이슈 공유', ...]
  topics       jsonb not null default '[]'::jsonb,

  presenter_id uuid references public.members (id) on delete set null,
  talk_title   text,
  article_id   uuid references public.articles (id) on delete set null,
  qa_count     integer not null default 0,
  photo_path   text,

  created_at   timestamptz not null default now()
);

comment on table  public.meetings        is '주간 정기 모임 아카이브';
comment on column public.meetings.topics is '토론한 요약 게시물 제목 배열';

create table if not exists public.meeting_attendees (
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  member_id  uuid not null references public.members (id) on delete cascade,
  primary key (meeting_id, member_id)
);

-- ---------------------------------------------------------------------------
-- rotations : 발표 순번(월 1회) + 주간 리뷰 당번
--   디자인의 rotation(2029~2042행) / duty(1954~1963행) 두 목록을 한 테이블로 합침
-- ---------------------------------------------------------------------------
create table if not exists public.rotations (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('deep', 'weekly')),
  member_id    uuid not null references public.members (id) on delete cascade,

  period_label text not null,                 -- '9월 16일' / '8월 3주차'
  period_start date not null,                 -- 정렬·현재 주기 판별용
  topic        text,                          -- 주간 당번의 담당 주제

  status       text not null default 'planned'
               check (status in ('planned', 'preparing', 'reviewing', 'done')),

  created_at   timestamptz not null default now()
);

comment on table  public.rotations      is 'deep=월 1회 심층 발표 순번, weekly=주간 리뷰 당번';
comment on column public.rotations.status is 'planned(예정) | preparing(준비 중) | reviewing(검토 중) | done(완료)';

-- ---------------------------------------------------------------------------
-- scraps : 구독자 스크랩
--   대상이 세 테이블(articles / trend_items / geek_news)에 흩어져 있어
--   (type, key) 조합으로 참조한다. key 는 articles.id 또는 URL PK.
-- ---------------------------------------------------------------------------
create table if not exists public.scraps (
  member_id   uuid not null references public.members (id) on delete cascade,
  target_type text not null check (target_type in ('article', 'trend', 'geek')),
  target_key  text not null,
  created_at  timestamptz not null default now(),
  primary key (member_id, target_type, target_key)
);

comment on column public.scraps.target_key is 'article 이면 articles.id, trend 면 trend_items.source_url, geek 이면 geek_news.url';

-- ===========================================================================
-- 0005_ops.sql
-- ===========================================================================

-- 0005_ops.sql
-- 운영 : 동기화 실행 로그, 분할 암호화 업로드 이력.

-- ---------------------------------------------------------------------------
-- sync_runs : 수집 파이프라인 실행 기록
--   관리자 화면의 pipeline.log 콘솔(디자인 722~736행)이 이 테이블을 읽는다.
-- ---------------------------------------------------------------------------
create table if not exists public.sync_runs (
  id             uuid primary key default gen_random_uuid(),

  kind           text not null check (kind in ('geeknews', 'trend')),
  provider       text check (provider in ('gemini', 'openai')),   -- geeknews 는 null
  trigger        text not null default 'manual'
                 check (trigger in ('schedule', 'manual', 'admin_ui')),

  status         text not null default 'running'
                 check (status in ('running', 'success', 'failed')),

  started_at     timestamptz not null default now(),
  finished_at    timestamptz,

  fetched_count  integer not null default 0,   -- 원문에서 긁어온 총 건수
  new_count      integer not null default 0,   -- 기존 PK 와 겹치지 않은 신규 건수
  inserted_count integer not null default 0,   -- 실제 저장된 건수
  skipped_count  integer not null default 0,   -- 중복/기간 밖으로 건너뛴 건수

  -- [{ "at": "07:12:04", "level": "info"|"warn"|"error"|"done", "msg": "..." }]
  logs           jsonb not null default '[]'::jsonb,
  error          text
);

comment on table  public.sync_runs      is '긱뉴스/트렌드 동기화 실행 기록. 관리자 콘솔의 pipeline.log 원천.';
comment on column public.sync_runs.logs is '진행 로그 배열 — 관리자 화면이 폴링해 콘솔에 렌더';

-- ---------------------------------------------------------------------------
-- attachments : 발표 자료 분할 암호화 업로드
--   사내 정책상 1회 전송 최대 10MB → 클라이언트에서 조각내 AES-256-GCM 으로
--   암호화 전송하고, 서버가 복호화해 Storage 에 합친다.
-- ---------------------------------------------------------------------------
create table if not exists public.attachments (
  id               uuid primary key default gen_random_uuid(),
  article_id       uuid references public.articles (id) on delete cascade,

  file_name        text not null,
  mime_type        text,
  size_bytes       bigint not null,

  chunk_size_bytes integer not null,
  chunk_count      integer not null,
  received_chunks  integer not null default 0,

  status           text not null default 'pending'
                   check (status in ('pending', 'uploading', 'assembling', 'stored', 'failed')),

  storage_path     text,
  uploaded_by      uuid references public.members (id) on delete set null,
  error            text,

  -- 이 업로드 전용 AES-256-GCM 키(base64). 서버가 생성해 HTTPS 로 클라이언트에
  -- 내려주고, 조각을 복호화하는 데 쓴다. 업로드가 끝나면 null 로 지운다.
  -- 이 테이블은 RLS 로 잠겨 있어 service_role 만 읽을 수 있다.
  encryption_key   text,

  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);

comment on table  public.attachments        is '발표 자료 분할 암호화 업로드 이력 (10MB 전송 한도 대응)';
comment on column public.attachments.status is 'pending → uploading → assembling → stored / failed';
comment on column public.attachments.encryption_key is '업로드 진행 중에만 보관하는 임시 AES 키. 완료 시 null 로 지운다.';

-- ===========================================================================
-- 0006_indexes.sql
-- ===========================================================================

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

-- ===========================================================================
-- 0007_rls.sql
-- ===========================================================================

-- 0007_rls.sql
-- RLS 정책.
--
-- 이 서비스는 Supabase Auth 를 쓰지 않는다. 로그인은 사내 SSO 이고, 브라우저에는
-- Supabase 키를 일절 내려보내지 않는다. 모든 DB 접근은 Next.js 서버가
-- service_role 키로 수행한다.
--
-- 따라서 "RLS 를 켜고 정책은 하나도 만들지 않는" 구성이 맞다.
--   - service_role 은 RLS 를 우회하므로 서버 코드는 정상 동작한다.
--   - anon / authenticated 롤은 정책이 없으므로 모든 접근이 거부된다.
--     (anon 키가 유출되거나 실수로 클라이언트에서 호출해도 사내 콘텐츠가 새지 않는다)
--
-- 나중에 클라이언트 직접 조회가 필요해지면 그때 select 정책을 명시적으로 추가한다.

alter table public.members           enable row level security;
alter table public.app_settings      enable row level security;
alter table public.geek_news         enable row level security;
alter table public.trend_items       enable row level security;
alter table public.articles          enable row level security;
alter table public.article_sources   enable row level security;
alter table public.comments          enable row level security;
alter table public.meetings          enable row level security;
alter table public.meeting_attendees enable row level security;
alter table public.rotations         enable row level security;
alter table public.scraps            enable row level security;
alter table public.sync_runs         enable row level security;
alter table public.attachments       enable row level security;

-- anon / authenticated 롤에 남아 있을 수 있는 기본 권한도 회수해 둔다.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- ===========================================================================
-- 0008_seed.sql
-- ===========================================================================

-- 0008_seed.sql
-- 초기 데이터. 여러 번 실행해도 안전하도록 전부 idempotent 하게 작성한다.
-- 사번은 임시값이므로 실제 운영 전에 교체할 것.

-- ---------------------------------------------------------------------------
-- 발행 설정 (디자인의 props 3종)
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('issue_no',           '128'::jsonb),
  ('publisher',          '"Samsung SDS · AI Unit"'::jsonb),
  ('show_en_subtitles',  'true'::jsonb),
  ('publish_hour_label', '"07:00 KST 발행"'::jsonb),
  ('security_notice',    '"사내 문서 보안 등급 II · 외부 공유 금지"'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 유닛원 (디자인 AV 맵의 4명)
-- ---------------------------------------------------------------------------
insert into public.members (emp_no, name, role, is_admin, initial, avatar_tone, dept) values
  ('21084213', '박세원', 'unit_lead',  true,  '세원', 'purple', 'AI Unit'),
  ('21084214', '문명훈', 'member',     true,  '명훈', 'blue',   'AI Unit'),
  ('21084215', '박미숙', 'member',     true,  '미숙', 'green',  'AI Unit'),
  ('21084216', '한솔아', 'member',     true,  '솔아', 'yellow', 'AI Unit')
on conflict (emp_no) do nothing;

-- 구독자 예시 (디자인의 READER)
insert into public.members (emp_no, name, role, is_admin, initial, avatar_tone, dept) values
  ('21099001', '김도현', 'subscriber', false, '도현', 'gray', 'AI Unit 구독')
on conflict (emp_no) do nothing;

-- ---------------------------------------------------------------------------
-- 심층 분석 발표 순번 (월 1회, 4주 주기)
-- ---------------------------------------------------------------------------
insert into public.rotations (kind, member_id, period_label, period_start, status)
select 'deep', m.id, v.period_label, v.period_start::date, v.status
from (values
  ('박세원', '8월 · 완료',  '2026-08-19', 'done'),
  ('문명훈', '9월 16일',    '2026-09-16', 'preparing'),
  ('박미숙', '10월 14일',   '2026-10-14', 'planned'),
  ('한솔아', '11월 11일',   '2026-11-11', 'planned')
) as v(name, period_label, period_start, status)
join public.members m on m.name = v.name
where not exists (
  select 1 from public.rotations r
  where r.kind = 'deep' and r.member_id = m.id and r.period_start = v.period_start::date
);

-- ---------------------------------------------------------------------------
-- 이번 주 주간 리뷰 당번
-- ---------------------------------------------------------------------------
insert into public.rotations (kind, member_id, period_label, period_start, topic, status)
select 'weekly', m.id, v.period_label, v.period_start::date, v.topic, v.status
from (values
  ('박세원', '8월 3주차', '2026-08-17', 'agent-lightning 리뷰',   'done'),
  ('문명훈', '8월 3주차', '2026-08-17', 'vLLM 스케줄러 PR',        'done'),
  ('박미숙', '8월 3주차', '2026-08-17', '리랭커 비교 실험',        'done'),
  ('한솔아', '8월 3주차', '2026-08-17', 'HN 도입 실패담 정리',     'reviewing')
) as v(name, period_label, period_start, topic, status)
join public.members m on m.name = v.name
where not exists (
  select 1 from public.rotations r
  where r.kind = 'weekly' and r.member_id = m.id and r.period_start = v.period_start::date
);

