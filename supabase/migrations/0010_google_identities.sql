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
