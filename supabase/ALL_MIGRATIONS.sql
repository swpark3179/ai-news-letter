-- =============================================================================
-- AI 뉴스레터 — 전체 스키마 (통합본)
--
-- supabase/migrations/ 의 SQL 을 번호 순서대로 이어 붙인 것입니다.
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 한 번에 Run 하세요.
--
-- 여러 번 실행해도 안전합니다 — 표는 `if not exists`, 시드는
-- `on conflict do nothing`, 뷰는 지우고 다시 만듭니다.
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
comment on column public.trend_items.body           is '블록 배열 [{type:text|head|quote|table, t, align?, size?, color?, rows?}]';

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
comment on column public.articles.body    is '블록 배열 [{type:text|head|quote|table, t, align?, size?, color?, rows?}]';
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

-- ===========================================================================
-- 0009_scraps.sql
-- ===========================================================================

-- 0009_scraps.sql
-- 보관함(스크랩) 조회용 인덱스.
--
-- 테이블 자체는 0004_unit.sql 에 이미 있다. 화면이 붙으면서 생긴 조회 패턴은
-- 세 가지다.
--   1) 내 보관함        member_id + 최근 보관순        → scraps_member_created_idx
--   2) 목록의 보관 여부  (member_id, target_type, target_key) 다건 → PK 인덱스로 처리
--   3) 관리자 통계      (target_type, target_key) 로 묶어 세기 → scraps_target_idx

create index if not exists scraps_member_created_idx
  on public.scraps (member_id, created_at desc);

create index if not exists scraps_target_idx
  on public.scraps (target_type, target_key);

comment on table public.scraps is
  '사용자가 나중에 다시 읽으려고 보관해 둔 게시물. 목록은 본인만 보고, 집계는 관리자 화면에서만 본다.';

-- ===========================================================================
-- 0010_google_identities.sql
-- ===========================================================================

-- =============================================================================
--  0010_google_identities.sql
--  모바일 앱의 Google 로그인을 웹의 기존 계정(public.members)에 잇는다.
--
--  출처:      swpark3179/ai-news-letter-mobile 저장소의 server/migrations/ 에서 가져왔다
--  적용 방법: Supabase SQL 편집기에 붙여 넣고 실행
--             (이 저장소는 Supabase CLI 를 쓰지 않고 수동 적용한다)
--  적용 후:   `npm run sql:bundle` 로 supabase/ALL_MIGRATIONS.sql 을 다시 만든다
--
--  배경 — 이 마이그레이션이 왜 이렇게 생겼는가
--  ---------------------------------------------------------------------------
--  웹의 사용자 테이블은 `public.members` 이고 **자연 키가 사번(emp_no)** 이다.
--  `email` 은 nullable 이고, 0008_seed.sql 로 들어간 계정들은 email 이 비어 있다.
--  그래서 "Google 메일로 기존 계정을 찾는다"만으로는 기존 가입자와 이어 붙지 않는다.
--
--  연결 규칙을 세 단계로 둔 이유가 그것이다:
--    1) google_sub 매칭        — 재로그인. 가장 확실하다.
--    2) 검증된 이메일 매칭      — members.email 이 채워진 계정에 한해 자동 연결.
--    3) 신규 members 행 생성    — 위 둘이 실패하면 자동 가입(사용자 결정).
--       이때 emp_no 는 `google:<sub>` 로 채운다. 실제 사번(숫자 8자리)과 절대
--       충돌하지 않으면서 NOT NULL UNIQUE 제약을 만족시키기 위해서다.
--       앱은 이 형태를 알아보고 「사번으로 기존 계정 연결」 안내를 띄운다.
--
--  2) 가 실제로 동작하게 하려면 members.email 을 채워야 한다.
--  맨 아래 「선택: 이메일 백필」을 참고.
-- =============================================================================

-- ── 1. Google 계정 ↔ 멤버 매핑 ───────────────────────────────────────────────
create table if not exists public.member_google_identities (
  -- Google 계정의 불변 식별자(OpenID Connect `sub`).
  -- Google 공식 문서: "unique among all Google Accounts and never reused".
  -- 이메일은 바뀔 수 있으므로 이쪽을 키로 잡는다.
  google_sub     text primary key,

  member_id      uuid not null references public.members (id) on delete cascade,

  -- 마지막 로그인 시점의 값. 참고용이며 식별에 쓰지 않는다.
  google_email   text not null,
  email_verified boolean not null default false,

  -- Workspace 도메인(`hd` 클레임). 사내 계정 제한을 켤 때 쓴다.
  hosted_domain  text,

  display_name   text,
  picture_url    text,

  linked_at      timestamptz not null default now(),
  last_login_at  timestamptz,

  -- 한 멤버가 여러 Google 계정을 붙이는 것은 허용하되(퇴사·재입사 등),
  -- 같은 Google 계정이 두 멤버에 붙는 것은 primary key 가 막는다.
  constraint member_google_identities_email_not_blank check (length(trim(google_email)) > 0)
);

comment on table public.member_google_identities is
  '모바일 앱 Google 로그인 ↔ members 매핑. google_sub 가 불변 식별자다.';
comment on column public.member_google_identities.google_sub is
  'OpenID Connect sub 클레임. 이메일이 바뀌어도 유지된다.';
comment on column public.member_google_identities.hosted_domain is
  'ID 토큰의 hd 클레임. 개인 Gmail 은 null 이다. 도메인 제한을 켤 때 검사한다.';

create index if not exists member_google_identities_member_idx
  on public.member_google_identities (member_id);

-- 이메일로 기존 계정을 찾을 때 쓰는 대소문자 무시 조회용 인덱스.
-- members.email 에는 이미 (대소문자 구분) unique 제약이 있다.
create index if not exists members_email_lower_idx
  on public.members (lower(email))
  where email is not null;

-- ── 2. 모바일 세션(리프레시 토큰) ────────────────────────────────────────────
-- 웹은 HttpOnly 쿠키 `ainl_session` 에 8시간짜리 JWT 를 담는다.
-- 앱에서 8시간마다 다시 로그인하게 할 수는 없으므로,
-- 짧은 액세스 토큰 + 긴 리프레시 토큰으로 나눈다.
-- 원문 토큰은 저장하지 않고 sha256 해시만 남긴다.
create table if not exists public.member_refresh_tokens (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.members (id) on delete cascade,

  -- encode(digest(raw_token, 'sha256'), 'hex')
  token_hash   text not null unique,

  -- 「iPhone 15 · iOS 26.1」 같은 사람이 읽을 수 있는 라벨. 세션 목록용.
  device_label text,

  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz
);

comment on table public.member_refresh_tokens is
  '모바일 앱 리프레시 토큰. 원문이 아니라 sha256 해시를 저장한다.';

create index if not exists member_refresh_tokens_member_idx
  on public.member_refresh_tokens (member_id)
  where revoked_at is null;

create index if not exists member_refresh_tokens_expiry_idx
  on public.member_refresh_tokens (expires_at)
  where revoked_at is null;

-- ── 3. RLS ───────────────────────────────────────────────────────────────────
-- 이 저장소의 규칙(0007_rls.sql)과 같다: RLS 는 켜되 정책은 두지 않고,
-- 모든 접근은 Next 서버의 service_role 로만 한다.
alter table public.member_google_identities enable row level security;
alter table public.member_refresh_tokens    enable row level security;

revoke all on public.member_google_identities from anon, authenticated;
revoke all on public.member_refresh_tokens    from anon, authenticated;

-- ── 4. 선택: 이메일 백필 ─────────────────────────────────────────────────────
-- members.email 이 비어 있으면 Google 메일로 기존 계정을 자동으로 찾을 수 없다.
-- 사내 메일 규칙이 확정되면 아래처럼 한 번 채워 두는 것이 좋다.
-- (규칙을 모르는 상태로 실행하면 엉뚱한 계정이 연결될 수 있으니 그냥 두어도 된다 —
--  그 경우 사용자는 앱에서 「사번으로 기존 계정 연결」을 쓰면 된다.)
--
--   update public.members
--      set email = emp_no || '@samsung.com'
--    where email is null
--      and emp_no ~ '^[0-9]{8}$';
--
-- 백필 전에 충돌 여부를 먼저 확인할 것:
--   select emp_no || '@samsung.com' as candidate, count(*)
--     from public.members
--    where email is null and emp_no ~ '^[0-9]{8}$'
--    group by 1 having count(*) > 1;

-- ===========================================================================
-- 0011_apple_identities.sql
-- ===========================================================================

-- =============================================================================
--  0011_apple_identities.sql
--  모바일 앱의 Apple 로그인을 웹의 기존 계정(public.members)에 잇는다.
--
--  출처:      swpark3179/ai-news-letter-mobile 저장소의 server/migrations/ 에서 가져왔다
--  적용 방법: Supabase SQL 편집기에 붙여 넣고 실행
--             (이 저장소는 Supabase CLI 를 쓰지 않고 수동 적용한다)
--  적용 후:   `npm run sql:bundle` 로 supabase/ALL_MIGRATIONS.sql 을 다시 만든다
--  선행:      0010_google_identities.sql
--
--  배경 — 왜 로그인 수단이 하나 더 늘었는가
--  ---------------------------------------------------------------------------
--  App Store 가이드라인 4.8 은 제3자 로그인(Google 등)만 제공하는 앱에
--  「동등한 다른 수단」을 함께 두라고 요구한다. 예외(사내 계정 전용 앱)를
--  주장할 수도 있지만, 그러려면 서버에서 도메인을 실제로 잠가야 한다
--  (ALLOWED_HOSTED_DOMAINS). 현재 방침은 「제한 없음」이라 예외가 성립하지 않는다.
--  자세한 판단 근거는 모바일 저장소 docs/10-deploy-ios.md 의 「가이드라인 4.8」.
--
--  왜 member_google_identities 를 고쳐 쓰지 않고 표를 하나 더 만드는가
--  ---------------------------------------------------------------------------
--  두 가지 이유다.
--    1) 0010 은 이미 적용되었을 수 있다. 적용된 표의 PK 이름을 바꾸는 것은
--       되돌리기 어려운 마이그레이션이 된다.
--    2) 두 공급자가 실제로 다르다. Apple 은 「이메일 가리기」로 릴레이 주소를
--       내주고(is_private_email), 이름과 메일을 **최초 인증 때 한 번만** 준다.
--       Google 에는 hosted_domain(hd) 이 있고 Apple 에는 없다.
--       공용 표에 억지로 합치면 절반이 늘 비어 있는 열이 된다.
--
--  대신 두 표를 같은 모양으로 맞춰 두었다 — 조회 코드가 거의 같다.
--  (src/lib/auth/social-identity.ts)
-- =============================================================================

-- ── 1. Apple 계정 ↔ 멤버 매핑 ────────────────────────────────────────────────
create table if not exists public.member_apple_identities (
  -- Apple ID 의 불변 식별자(ID 토큰의 `sub`).
  -- **팀 단위로만 고유하다** — 같은 Apple ID 라도 다른 개발자 팀의 앱에서는
  -- 다른 sub 을 받는다. 우리에게는 한 팀뿐이라 문제가 없다.
  apple_sub        text primary key,

  member_id        uuid not null references public.members (id) on delete cascade,

  -- 마지막 로그인 시점의 값. 참고용이며 식별에 쓰지 않는다.
  -- Apple 은 「이메일 가리기」를 고른 사용자에게 @privaterelay.appleid.com
  -- 주소를 주므로 **비어 있을 수 있다**(재로그인 때 토큰에서 빠지는 경우).
  apple_email      text,
  email_verified   boolean not null default false,

  -- 릴레이 주소인지. 앱은 이 경우 주소 대신 「Apple 비공개 이메일」을 보여 준다.
  is_private_email boolean not null default false,

  -- Apple 이 최초 인증에서 한 번만 주는 이름. 놓치면 다시 받을 수 없다.
  display_name     text,

  linked_at        timestamptz not null default now(),
  last_login_at    timestamptz,

  constraint member_apple_identities_email_not_blank
    check (apple_email is null or length(trim(apple_email)) > 0)
);

comment on table public.member_apple_identities is
  '모바일 앱 Apple 로그인 ↔ members 매핑. apple_sub 가 불변 식별자다.';
comment on column public.member_apple_identities.apple_sub is
  'Apple ID 토큰의 sub 클레임. 개발자 팀 단위로 고유하고 바뀌지 않는다.';
comment on column public.member_apple_identities.apple_email is
  '마지막 로그인 때의 메일. 「이메일 가리기」면 릴레이 주소이고, 없을 수도 있다.';
comment on column public.member_apple_identities.is_private_email is
  'true 면 릴레이 주소다. 사람에게 그대로 보여 주지 않는다.';

create index if not exists member_apple_identities_member_idx
  on public.member_apple_identities (member_id);

-- 검증된 메일로 기존 계정을 찾을 때 쓰는 대소문자 무시 조회용.
-- (members 쪽 인덱스는 0010 에서 이미 만들었다.)
create index if not exists member_apple_identities_email_lower_idx
  on public.member_apple_identities (lower(apple_email))
  where apple_email is not null;

-- ── 2. RLS ───────────────────────────────────────────────────────────────────
-- 0007_rls.sql·0010 과 같은 규칙: RLS 는 켜되 정책은 두지 않고,
-- 모든 접근은 Next 서버의 service_role 로만 한다.
alter table public.member_apple_identities enable row level security;
revoke all on public.member_apple_identities from anon, authenticated;

-- ── 3. 자동 가입 계정의 emp_no ───────────────────────────────────────────────
-- 0010 이 Google 자동 가입 계정에 `google:<sub>` 을 넣은 것과 같은 규칙으로
-- Apple 은 `apple:<sub>` 을 쓴다. 실제 사번(숫자 8자리)과 절대 충돌하지 않고,
-- 앱이 접두사를 보고 「사번으로 기존 계정 연결」 안내를 띄운다.
--
-- 지금 어떤 계정이 자동 가입으로 만들어졌는지 보려면:
--
--   select emp_no, name, email, created_at
--     from public.members
--    where emp_no like 'google:%' or emp_no like 'apple:%'
--    order by created_at desc;
--
-- 같은 사람이 Google 과 Apple 로 각각 들어오면 계정이 둘 생긴다. 이메일이
-- 같으면 두 번째 로그인이 첫 계정에 이어 붙지만, Apple 「이메일 가리기」를
-- 쓰면 이메일이 달라 이어 붙지 않는다. 그때는 앱의 「사번으로 기존 계정 연결」로
-- 합친다 (모바일 저장소 docs/05-account-linking.md 의 「엣지 케이스」).

-- ===========================================================================
-- 0012_member_epid.sql
-- ===========================================================================

-- =============================================================================
--  0012_member_epid.sql
--  사내 SSO(Knox 트레이)가 돌려주는 EPID 를 members 에 담는다.
--
--  적용 방법: Supabase SQL 편집기에 붙여 넣고 실행
--             (이 저장소는 Supabase CLI 를 쓰지 않고 수동 적용한다)
--  적용 후:   `npm run sql:bundle` 로 supabase/ALL_MIGRATIONS.sql 을 다시 만든다
--  선행:      0002_core.sql (members)
--
--  왜 사번(emp_no)만으로 충분하지 않은가
--  ---------------------------------------------------------------------------
--  트레이가 돌려주는 식별자는 EPID 이고, 이 조직에서 EPID 는 사번과 **다른 값**이다.
--  그래서 사번 컬럼에 밀어 넣지 않고 따로 둔다. 로그인 조회의 기준 키는 EPID 이며
--  (src/lib/auth/current-user.ts 의 resolveMemberFromSso), 사번은 EPID 를 아직
--  모르는 기존 계정을 찾아내는 폴백으로만 쓰인다.
--
--  왜 백필하지 않는가
--  ---------------------------------------------------------------------------
--  EPID 와 사번이 다른 체계이므로 `epid = emp_no` 로 채우면 **틀린 값**이 아래
--  유니크 인덱스를 선점한다. 그러면 정작 진짜 EPID 로 로그인한 사람이 23505 로
--  막힌다. 기존 시드 계정은 첫 SSO 로그인 때 사번 폴백으로 찾아낸 뒤 그 행에
--  EPID 를 채우는 방식(백필)으로 자연스럽게 이어 붙는다.
-- =============================================================================

alter table public.members add column if not exists epid text;

comment on column public.members.epid is
  '사내 SSO(Knox) 사원 식별자. 사번(emp_no)과는 다른 별도 ID. 최초 SSO 로그인 때 채워진다.';

-- 아직 EPID 를 모르는 계정이 많으므로 null 은 여러 행이 가질 수 있어야 한다.
-- 일반 unique 제약은 null 을 서로 다른 값으로 보아 허용하지만, 의도를 분명히
-- 남기고 인덱스 크기를 줄이기 위해 부분 유니크 인덱스로 건다.
create unique index if not exists members_epid_key
  on public.members (epid)
  where epid is not null;

-- ===========================================================================
-- 0013_mobile_read_access.sql
-- ===========================================================================

-- 0013_mobile_read_access.sql
-- 모바일 앱이 읽을 뷰 3개와 anon 권한.
--
-- ---------------------------------------------------------------------------
-- 0007_rls.sql 의 방침을 여기서 한 걸음 넓힌다
-- ---------------------------------------------------------------------------
-- 0007 은 "RLS 를 켜고 정책은 하나도 만들지 않는" 구성이었다. 브라우저에 Supabase
-- 키를 내려보내지 않고 모든 접근을 Next.js 서버가 service_role 로 대신하기 때문이다.
-- 그 파일의 마지막 줄이 이 변경을 예고해 두었다 —
--   "나중에 클라이언트 직접 조회가 필요해지면 그때 select 정책을 명시적으로 추가한다."
--
-- 모바일 앱이 그 경우다. 앱은 웹 API 를 거치지 않고 PostgREST 를 직접 읽는다.
-- 앱 바이너리에는 anon 키가 실린다(그것이 anon 키의 설계다). 따라서 안전성은
-- 전적으로 아래 grant 구성에서 나온다.
--
-- **테이블이 아니라 뷰만 연다.** 두 가지 이유다.
--
--   ① 쿼리 표면을 좁힌다. 테이블에 grant 하면 PostgREST 가 그 테이블의 모든
--      컬럼·필터·정렬을 열어 준다. 뷰만 열면 노출 범위가 뷰 정의로 고정된다.
--      숨긴 콘텐츠 필터(is_hidden / status)도 뷰 안에 박혀 있어 우회할 길이 없다.
--
--   ② 목록의 지표 문구(meta)를 SQL 이 만들어 내려보낸다. 이 규칙을 클라이언트로
--      옮겨 적으면 규칙이 두 벌이 되고, 그건 이미 한 번 어긋난 지점이다.
--      정본은 웹의 src/lib/trendItem.ts 의 metricOf() / metaTextOf() 다.
--
--      웹과 일부러 다르게 둔 곳이 하나 있다. metrics 의 값이 숫자가 아니면
--      (예: comments 에 문자열이 들어오면) 웹은 그 값을 그대로 이어 붙이지만
--      여기서는 지표를 비운다. 수집 스크립트가 숫자만 넣으므로 실제로는 생기지
--      않는 경우이고, 생겼다면 화면에 이상한 문구를 내보내는 것보다 비우는 편이 낫다.
--
-- 뷰는 security_invoker 를 켜지 않는다(기본값). 소유자 권한으로 돌아야 anon 이
-- 뷰를 읽어도 밑에 있는 테이블의 RLS 를 건드리지 않는다.
--
-- 열리는 것: mobile_feed · mobile_trend_detail · mobile_issue (SELECT 만)
-- 닫힌 채로 남는 것: 원본 테이블 전부, members · scraps · articles · comments
--
-- 앱이 거는 질의는 mobile/docs/03-api-contract.md 에 적어 두었다.
-- ---------------------------------------------------------------------------

-- 컬럼 구성이 바뀌어도 다시 실행할 수 있도록 지우고 만든다.
drop view if exists public.mobile_feed;
drop view if exists public.mobile_trend_detail;
drop view if exists public.mobile_issue;

-- ---------------------------------------------------------------------------
-- mobile_feed : 목록 화면 전부를 덮는 하나의 뷰
--
--   긱뉴스와 트렌드를 같은 모양으로 정규화한 union 이다. 홈은 이 뷰를 그대로
--   시간 역순으로 읽고, 긱뉴스 탭·트렌드 탭은 type/source 필터만 더한다.
--
--   union 을 뷰 안에서 해 두는 것이 핵심이다. 앱이 두 테이블을 따로 읽어 합치면
--   커서가 서로 다른 시간축(geek=published_at, trend=collected_at)을 하나로
--   다루게 되고, 그 지점에서 항목이 조용히 사라진다.
--
--   published_at 의 의미:
--     geek  — 긱뉴스 목록의 <time datetime> (원문 게시 시각)
--     trend — collected_at. trend_items 에는 원문 발행일 컬럼이 없다.
-- ---------------------------------------------------------------------------
create view public.mobile_feed as
select
    'geek'::text                                   as type,
    g.url                                          as key,
    null::text                                     as source,
    null::text                                     as repo,
    g.title                                        as title,
    g.summary                                      as lede,
    -- 디자인 규칙: "github.com · 42 points · 댓글 12"
    concat_ws(' · ',
      nullif(btrim(coalesce(g.source_domain, '')), ''),
      g.points || ' points',
      '댓글 ' || g.comment_count
    )                                              as meta,
    g.published_at                                 as published_at,
    -- 원문 사이트(external_url)가 아니라 긱뉴스 토픽 URL 을 연다. 요약과 댓글이
    -- 거기 있고, 이 값이 곧 담기 키다.
    g.url                                          as open_url,
    coalesce(g.source_domain, '')                  as host,
    null::text                                     as public_id,
    null::text                                     as source_variant,
    concat_ws(' ', g.title, g.summary)             as search_text
  from public.geek_news g
  where g.is_hidden = false

union all

select
    'trend'::text,
    t.source_url,
    t.source,
    -- 저장소 이름이 AI 헤드라인보다 눈에 빨리 들어와 제목 자리를 가져간다.
    -- raw_title 이 비어도 PK 가 https://github.com/{owner}/{repo} 라 복구할 수 있다.
    case
      when t.source <> 'github' then null
      else coalesce(
        nullif(btrim(coalesce(t.raw_title, '')), ''),
        nullif(regexp_replace(t.source_url, '^https?://github\.com/|/+$', '', 'g'), t.source_url)
      )
    end,
    t.title,
    coalesce(t.deck, ''),
    -- "★ 4,812 this week · Python" / "412 comments" / "arXiv:2608.01234"
    concat_ws(' · ', m.metric, nullif(btrim(coalesce(m.language, '')), '')),
    t.collected_at,
    t.source_url,
    coalesce(substring(t.source_url from '^https?://([^/?#]+)'), ''),
    t.public_id,
    t.source_variant,
    concat_ws(' ', t.title, t.deck, t.raw_title, array_to_string(t.tags, ' '))
  from public.trend_items t
  -- metrics 는 jsonb 라 어떤 값이든 들어올 수 있다. 숫자인지 먼저 확인하고 꺼낸다 —
  -- 한 행의 이상한 값 때문에 목록 전체가 죽으면 안 된다.
  cross join lateral (
    select
      t.metrics ->> 'language' as language,
      case t.source
        when 'github' then
          case
            when coalesce(
                   case when jsonb_typeof(t.metrics -> 'stars_in_period') = 'number'
                        then nullif((t.metrics ->> 'stars_in_period')::bigint, 0) end,
                   case when jsonb_typeof(t.metrics -> 'stars') = 'number'
                        then nullif((t.metrics ->> 'stars')::bigint, 0) end
                 ) is null then null
            else '★ '
              || btrim(to_char(
                   coalesce(
                     case when jsonb_typeof(t.metrics -> 'stars_in_period') = 'number'
                          then nullif((t.metrics ->> 'stars_in_period')::bigint, 0) end,
                     case when jsonb_typeof(t.metrics -> 'stars') = 'number'
                          then nullif((t.metrics ->> 'stars')::bigint, 0) end
                   ), 'FM999,999,999,999'))
              || ' '
              || case t.source_variant
                   when 'weekly'  then 'this week'
                   when 'monthly' then 'this month'
                   else 'today'
                 end
          end
        when 'hn' then
          case when jsonb_typeof(t.metrics -> 'comments') = 'number'
                 and nullif((t.metrics ->> 'comments')::bigint, 0) is not null
               then (t.metrics ->> 'comments') || ' comments' end
        when 'arxiv' then
          case when nullif(btrim(coalesce(t.metrics ->> 'arxiv_id', '')), '') is not null
               then 'arXiv:' || btrim(t.metrics ->> 'arxiv_id') end
        when 'geeknews' then
          case when jsonb_typeof(t.metrics -> 'points') = 'number'
                 and nullif((t.metrics ->> 'points')::bigint, 0) is not null
               then (t.metrics ->> 'points') || ' points' end
      end as metric
  ) m
  where t.status = 'published';

comment on view public.mobile_feed is
  '모바일 목록용. geek_news + trend_items 를 FeedItem 모양으로 정규화한 union. anon SELECT 허용.';

-- ---------------------------------------------------------------------------
-- mobile_trend_detail : 트렌드 상세
--
--   body(jsonb) 와 tags 는 목록 질의에 실리면 무거우므로 mobile_feed 와 나눈다.
-- ---------------------------------------------------------------------------
create view public.mobile_trend_detail as
select
    t.source_url                                   as key,
    t.source                                       as source,
    t.public_id                                    as public_id,
    case
      when t.source <> 'github' then null
      else coalesce(
        nullif(btrim(coalesce(t.raw_title, '')), ''),
        nullif(regexp_replace(t.source_url, '^https?://github\.com/|/+$', '', 'g'), t.source_url)
      )
    end                                            as repo,
    t.source_variant                               as source_variant,
    t.title                                        as title,
    coalesce(t.deck, '')                           as deck,
    coalesce(t.raw_title, '')                      as raw_title,
    coalesce(substring(t.source_url from '^https?://([^/?#]+)'), '') as host,
    t.collected_at                                 as collected_at,
    t.llm_model                                    as llm_model,
    t.body                                         as body,
    t.tags                                         as tags
  from public.trend_items t
  where t.status = 'published';

comment on view public.mobile_trend_detail is
  '모바일 트렌드 상세. trend_items.body 를 그대로 내보낸다. anon SELECT 허용.';

-- ---------------------------------------------------------------------------
-- mobile_issue : 홈 마스트헤드 (항상 한 행)
--
--   건수 기준은 웹의 countGeekNewsToday() / countTrendToday() 와 같은
--   collected_date(KST) 다. 원문 발행일이 불명확한 출처가 섞여 있어 "오늘 몇 건을
--   퍼왔나"가 유일하게 말이 되는 셈법이다.
--
--   한 가지는 웹과 일부러 다르다: 웹의 두 함수는 is_hidden / status 를 보지 않지만
--   여기서는 건다. 이 숫자 바로 아래에 그 목록이 붙으므로, 목록에 없는 것을 세면
--   "긱뉴스 8" 아래에 7건이 보이는 일이 생긴다.
-- ---------------------------------------------------------------------------
create view public.mobile_issue as
select
    coalesce(s.issue_no, 1)                        as issue_no,
    coalesce(greatest(f.latest_geek, f.latest_trend), now()) as date,
    coalesce(c.geek_count, 0)                      as geek_count,
    coalesce(c.trend_count, 0)                     as trend_count
  from (
    select case when jsonb_typeof(value) = 'number' then (value #>> '{}')::int end as issue_no
      from public.app_settings
     where key = 'issue_no'
  ) s
  full join (
    select
      (select max(published_at) from public.geek_news   where is_hidden = false)     as latest_geek,
      (select max(collected_at) from public.trend_items where status = 'published')  as latest_trend
  ) f on true
  full join (
    select
      (select count(*) from public.geek_news
        where is_hidden = false
          and collected_date = (timezone('Asia/Seoul', now()))::date)                as geek_count,
      (select count(*) from public.trend_items
        where status = 'published'
          and collected_date = (timezone('Asia/Seoul', now()))::date)                as trend_count
  ) c on true;

comment on view public.mobile_issue is
  '모바일 홈 마스트헤드 — 호수·최신 시각·오늘(KST) 건수. 항상 한 행. anon SELECT 허용.';

-- ---------------------------------------------------------------------------
-- 권한
--
--   0007 이 anon 에게서 모든 권한을 회수했으므로, 이 세 줄이 anon 이 가진 권한의
--   전부가 된다. 나중에 뷰를 더 만들더라도 여기에 명시적으로 적기 전까지는
--   열리지 않는다 — grant 를 스키마 단위로 주지 않는 이유다.
-- ---------------------------------------------------------------------------
grant usage on schema public to anon;
grant select on public.mobile_feed         to anon;
grant select on public.mobile_trend_detail to anon;
grant select on public.mobile_issue        to anon;

-- ===========================================================================
-- 0014_showcase.sql
-- ===========================================================================

-- 0014_showcase.sql
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

