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
