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
