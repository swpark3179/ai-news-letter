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
