-- 0020_graveyard.sql
-- 웹 · 앱 · 수집기 어느 쪽도 쓰지 않는 표와 함수를 graveyard 스키마로 옮긴다.
--
-- ---------------------------------------------------------------------------
-- 무엇을 옮기나
-- ---------------------------------------------------------------------------
-- 2단계에서 웹의 로그인 · 관리자 · 기사 · 댓글 · 모임 · 업로드를 걷어 냈고, 앱은 그보다
-- 먼저 로그인을 지웠다. 그 뒤로 아래를 읽거나 쓰는 코드가 어디에도 없다
-- (LIVE_ONLY.md 의 A · C).
--
--   표 (이 저장소)   members · articles · article_sources · comments · meetings ·
--                    meeting_attendees · rotations · scraps · attachments ·
--                    member_google_identities · member_refresh_tokens ·
--                    member_apple_identities
--   표 (운영에만)    allowed_social_identities · member_auth_accounts
--   함수 (운영에만)  current_member_id() · is_active_member() · mobile_resolve_member() ·
--                    mobile_match_member(uuid) · mobile_member_json(uuid, uuid) ·
--                    mobile_link_member_by_emp_no(text) · mobile_link_member_by_sign_key(text) ·
--                    mobile_clear_scraps() · mobile_delete_account()
--
-- 남기는 것: geek_news · showcase_items · trend_items · hada_contents · app_settings ·
-- sync_runs · 모바일 뷰 5개 · touch_updated_at()(app_settings 트리거가 쓴다) ·
-- collector_*(LIVE_ONLY.md B — 다시 검토하기로 했다).
--
-- ---------------------------------------------------------------------------
-- 왜 지우지 않고 옮기나
-- ---------------------------------------------------------------------------
-- 운영 카탈로그에서 확인한 바로는 남는 객체 중 이것들에 기대는 것이 없다 — 뷰 의존 0,
-- 정책 0, 다른 함수 본문의 참조 0, 바깥으로 나가는 FK 는 member_auth_accounts →
-- auth.users 하나뿐이다. 그래도 그 확인이 틀렸다면 drop 은 되돌릴 수 없고, 옮긴 것은
-- `alter table graveyard.x set schema public` 한 줄로 되돌릴 수 있다. 그래서 한동안
-- 여기 두고 지켜본 뒤 다음 마이그레이션에서 `drop schema graveyard cascade` 한다.
--
-- 옮겨도 행 · 인덱스 · 제약 · 트리거 · 소유 시퀀스(article_sources_id_seq)는 표를
-- 따라간다. graveyard 는 PostgREST 가 노출하는 스키마가 아니고, anon · authenticated
-- 에게 USAGE 도 주지 않는다.
--
-- ---------------------------------------------------------------------------
-- 여러 번 돌려도 되게
-- ---------------------------------------------------------------------------
-- 운영에만 있는 객체는 새 프로젝트에 없으므로 있는 것만 옮긴다. ALL_MIGRATIONS.sql 을
-- 다시 돌려 0002 등이 public 에 빈 표를 새로 만든 경우에는 graveyard 에 이미 같은
-- 이름이 있어 옮기지 않고 NOTICE 만 낸다 — 그 빈 표는 0018 이 닫아 두어 anon 에게
-- 보이지 않는다.
-- ---------------------------------------------------------------------------

create schema if not exists graveyard;
comment on schema graveyard is
  '안 쓰는 표 · 함수를 지우기 전에 잠시 두는 곳 (0020). anon · authenticated 는 접근하지 못한다.';
revoke all on schema graveyard from public, anon, authenticated;

do $$
declare
  moving text[] := array[
    'members', 'articles', 'article_sources', 'comments', 'meetings',
    'meeting_attendees', 'rotations', 'scraps', 'attachments',
    'member_google_identities', 'member_refresh_tokens', 'member_apple_identities',
    'allowed_social_identities', 'member_auth_accounts'];
  moving_fn text[] := array[
    'current_member_id', 'is_active_member', 'mobile_resolve_member',
    'mobile_match_member', 'mobile_member_json', 'mobile_link_member_by_emp_no',
    'mobile_link_member_by_sign_key', 'mobile_clear_scraps', 'mobile_delete_account'];
  blocker text;
  t text;
  f record;
begin
  -- 옮기기 전에 확인한다. 남는 뷰 · 표(FK) · 정책 · 함수가 옮길 표에 기대고 있으면 아무것도
  -- 옮기지 않고 멈춘다. 뷰는 OID 로 표를 가리켜 옮겨도 계속 돌지만, 그러면 graveyard 를
  -- 지울 때 cascade 로 함께 사라진다 — 그 전에 여기서 알아야 한다.
  select string_agg(distinct format('%s → %s', d.classid::regclass, c.relname), ', ')
    into blocker
    from pg_depend d
    join pg_class c on c.oid = d.refobjid
   where c.relnamespace = 'public'::regnamespace
     and c.relname = any (moving)
     and d.deptype = 'n'
     and case d.classid
           when 'pg_rewrite'::regclass then not exists (
             select 1 from pg_rewrite r join pg_class v on v.oid = r.ev_class
              where r.oid = d.objid
                and v.relnamespace = 'public'::regnamespace and v.relname = any (moving))
           when 'pg_constraint'::regclass then not exists (
             select 1 from pg_constraint k join pg_class s on s.oid = k.conrelid
              where k.oid = d.objid
                and s.relnamespace = 'public'::regnamespace and s.relname = any (moving))
           when 'pg_policy'::regclass then not exists (
             select 1 from pg_policy pol join pg_class s on s.oid = pol.polrelid
              where pol.oid = d.objid
                and s.relnamespace = 'public'::regnamespace and s.relname = any (moving))
           when 'pg_proc'::regclass then not exists (
             select 1 from pg_proc p
              where p.oid = d.objid
                and p.pronamespace = 'public'::regnamespace and p.proname = any (moving_fn))
           else false
         end;
  if blocker is not null then
    raise exception '옮길 표에 기대는 객체가 남아 있다: %', blocker;
  end if;

  foreach t in array moving loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    elsif to_regclass(format('graveyard.%I', t)) is not null then
      raise notice 'graveyard.% 가 이미 있어 public.% 는 그대로 둔다', t, t;
    else
      execute format('alter table public.%I set schema graveyard', t);
    end if;
  end loop;

  for f in
    select p.oid::regprocedure as fn, p.proname
      from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname = any (moving_fn)
  loop
    if exists (select 1 from pg_proc g
                where g.pronamespace = 'graveyard'::regnamespace and g.proname = f.proname) then
      raise notice 'graveyard.% 가 이미 있어 % 는 그대로 둔다', f.proname, f.fn;
    else
      execute format('alter function %s set schema graveyard', f.fn);
    end if;
  end loop;
end $$;

-- 권한은 객체를 따라 옮겨 온다. 0018 이 이미 닫았지만 스키마 단위로 한 번 더 닫는다.
revoke all on all tables    in schema graveyard from public, anon, authenticated;
revoke all on all sequences in schema graveyard from public, anon, authenticated;
revoke all on all functions in schema graveyard from public, anon, authenticated;

-- PostgREST 가 바뀐 스키마를 바로 반영하게 한다 (Supabase 는 DDL 을 감지해 스스로도 한다).
notify pgrst, 'reload schema';

-- 스스로 확인한다. SQL Editor · apply_migration 은 파일 하나를 한 트랜잭션으로 돌리므로
-- 예외가 나면 위에서 옮긴 것까지 전부 되돌아간다 (psql 로 돌린다면 --single-transaction).
do $$
declare
  left_over text;
  missing   text;
begin
  -- 1. 앱 · 웹이 읽는 다섯 뷰는 그대로 anon 이 읽을 수 있어야 한다.
  select string_agg(v, ', ')
    into missing
    from unnest(array['mobile_feed', 'mobile_trend_detail', 'mobile_issue',
                      'mobile_showcase', 'mobile_hada_content']) as v
   where to_regclass(format('public.%I', v)) is null
      or not has_table_privilege('anon', format('public.%I', v), 'SELECT');
  if missing is not null then
    raise exception 'anon 이 읽지 못하게 된 뷰: %', missing;
  end if;

  -- 2. graveyard 에는 anon · authenticated 가 들어오지 못한다.
  if has_schema_privilege('anon', 'graveyard', 'USAGE')
     or has_schema_privilege('authenticated', 'graveyard', 'USAGE') then
    raise exception 'graveyard 스키마에 anon · authenticated 의 USAGE 가 남아 있다';
  end if;

  -- 3. 옮긴 표가 남는 객체에 기대지 않는가 — 남는 뷰가 graveyard 표를 읽으면 안 된다.
  select string_agg(distinct v.oid::regclass::text, ', ')
    into left_over
    from pg_depend d
    join pg_rewrite r on r.oid = d.objid and d.classid = 'pg_rewrite'::regclass
    join pg_class v   on v.oid = r.ev_class
    join pg_class t   on t.oid = d.refobjid
   where t.relnamespace = 'graveyard'::regnamespace
     and v.relnamespace <> 'graveyard'::regnamespace;
  if left_over is not null then
    raise exception 'graveyard 의 표를 읽는 뷰가 남아 있다: %', left_over;
  end if;
end $$;
