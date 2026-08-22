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
