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
