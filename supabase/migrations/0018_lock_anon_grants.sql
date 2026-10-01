-- 0018_lock_anon_grants.sql
-- anon 에게 열린 것을 「모바일 뷰 5개의 SELECT」로 다시 좁힌다.
--
-- ---------------------------------------------------------------------------
-- 무엇이 새고 있었나
-- ---------------------------------------------------------------------------
-- 0013 · 0016 · 0017 은 뷰를 만들고 `grant select ... to anon` 한 줄만 적었다.
-- 그런데 Supabase 프로젝트에는 public 스키마의 기본 권한(default privileges)이
-- 깔려 있어서, postgres 가 새로 만드는 표·뷰·시퀀스·함수는 만들어지는 순간
-- anon · authenticated 에게 **전부** 열린다. grant select 는 그 위에 같은 권한을
-- 한 번 더 준 것일 뿐, 나머지를 거둬 가지 않는다.
--
-- 그 결과 실제 DB 에서 anon 이 갖고 있던 것:
--
--   ① 뷰 5개의 INSERT · UPDATE · DELETE · TRUNCATE · REFERENCES · TRIGGER.
--      mobile_showcase · mobile_trend_detail · mobile_hada_content 는 FROM 이 하나인
--      단순 뷰라 Postgres 가 자동으로 쓰기 가능한 뷰로 만든다. 뷰 소유자 postgres 는
--      BYPASSRLS 라 RLS 도 막지 못한다. 즉 앱 바이너리에서 꺼낸 anon 키 하나로
--      PostgREST 를 통해 trend_items · showcase_items · hada_contents 를 고치거나
--      지울 수 있었다.
--
--   ② security definer 함수 9개의 EXECUTE. 그중 mobile_member_json(uuid, uuid) 는
--      member id 만 넘기면 사번 · 이름 · 이메일을 돌려준다. 모바일 로그인 시절
--      (어느 저장소에도 정의가 남아 있지 않다)의 잔재다.
--
--   ③ collector_transfers_id_seq 의 USAGE · SELECT · UPDATE.
--
-- VERIFY.sql ⑫ 가 이 상태를 잡는 항목이다. 뷰를 새로 만든 뒤에는 꼭 돌려 보세요.
--
-- ---------------------------------------------------------------------------
-- 이 파일이 하는 일
-- ---------------------------------------------------------------------------
--   1. public 의 모든 표 · 뷰 · 시퀀스에서 anon · authenticated 권한을 회수한다.
--   2. public 의 모든 함수에서 anon · authenticated 의 EXECUTE 를 회수하고,
--      security definer 함수는 PUBLIC 의 EXECUTE 도 회수한다.
--   3. 모바일 뷰 5개에 SELECT 만 다시 준다 (앱이 하는 일은 이것뿐이다).
--   4. 기본 권한을 고쳐, 앞으로 만드는 객체가 저절로 열리지 않게 한다.
--   5. 결과를 스스로 확인하고, 하나라도 남아 있으면 예외로 전체를 되돌린다.
--
-- 이름을 하나씩 적지 않고 카탈로그를 훑는 이유: 위 ② 의 함수들은 이 저장소의
-- 마이그레이션에 없다. 이름을 적어 revoke 하면 새 프로젝트에서 ALL_MIGRATIONS.sql
-- 을 돌릴 때 「함수가 없다」로 멈춘다. 훑으면 있는 것만 닫는다 — 그리고 나중에
-- 무엇이 새로 생겨도 이 파일을 다시 돌리면 같은 상태로 돌아온다.
--
-- authenticated 도 같이 닫는다. 웹도 앱도 로그인을 하지 않으므로 이 역할로 들어오는
-- 정상 요청이 없다. 열어 둘 이유가 없는 문이다.
--
-- service_role 은 건드리지 않는다. 수집기(GitHub Actions)가 그 키로 표에 쓴다.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  -- 1. 표 · 뷰 · 시퀀스. 확장이 소유한 객체는 확장이 관리하므로 건너뛴다.
  for r in
    select c.oid::regclass as obj, c.relkind
      from pg_class c
     where c.relnamespace = 'public'::regnamespace
       and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_class'::regclass and d.objid = c.oid and d.deptype = 'e')
  loop
    if r.relkind = 'S' then
      execute format('revoke all on sequence %s from anon, authenticated', r.obj);
    else
      execute format('revoke all on table %s from anon, authenticated', r.obj);
    end if;
  end loop;

  -- 2. 함수. touch_updated_at() 같은 invoker 함수는 PUBLIC 실행 권한이 남아도
  --    호출자 권한으로 돌아 아무것도 열지 못하므로 PUBLIC 은 definer 만 회수한다.
  for r in
    select p.oid::regprocedure as fn, p.prosecdef
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and not exists (
         select 1 from pg_depend d
          where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from anon, authenticated', r.fn);
    if r.prosecdef then
      execute format('revoke execute on function %s from public', r.fn);
    end if;
  end loop;
end $$;

-- 3. 다시 여는 것은 이 다섯 줄뿐이다. 0013 · 0016 · 0017 의 grant 와 같은 내용이다.
grant usage on schema public to anon;
grant select on public.mobile_feed         to anon;
grant select on public.mobile_trend_detail to anon;
grant select on public.mobile_issue        to anon;
grant select on public.mobile_showcase     to anon;
grant select on public.mobile_hada_content to anon;

-- 4. 기본 권한. 앞으로 postgres 가 public 에 만드는 객체는 anon · authenticated 에게
--    아무것도 주지 않는다. 새 뷰를 앱에 열려면 그 마이그레이션에 grant select 를
--    적는 것으로 충분하다 — 지금까지처럼.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
-- 함수의 PUBLIC 실행 권한은 스키마 단위가 아니라 전역 기본값이라 스키마를 지정해서는
-- 회수되지 않는다. 그래서 이 한 줄은 postgres 가 만드는 모든 스키마의 함수에 걸린다.
-- 클라이언트가 RPC 를 하나도 부르지 않는 구성이라 잃는 것이 없다.
alter default privileges for role postgres
  revoke execute on functions from public;

-- 5. 스스로 확인한다. 예외가 나면 이 파일 전체가 되돌아간다.
do $$
declare
  leaked text;
begin
  select string_agg(format('%s:%s', c.relname, p.priv), ', ' order by c.relname, p.priv)
    into leaked
    from pg_class c
   cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as p(priv)
   where c.relnamespace = 'public'::regnamespace
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and has_table_privilege('anon', c.oid, p.priv)
     and not (p.priv = 'SELECT' and c.relname in (
       'mobile_feed', 'mobile_trend_detail', 'mobile_issue', 'mobile_showcase', 'mobile_hada_content'));
  if leaked is not null then
    raise exception 'anon 에게 아직 열려 있는 표·뷰 권한: %', leaked;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ')
    into leaked
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if leaked is not null then
    raise exception 'anon 이 아직 실행할 수 있는 security definer 함수: %', leaked;
  end if;
end $$;
