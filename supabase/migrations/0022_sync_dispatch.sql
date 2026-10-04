-- 0022_sync_dispatch.sql
-- 수집 워크플로를 pg_cron 이 정해진 시각에 직접 깨운다 (07:00 · 11:30 KST).
--
-- ---------------------------------------------------------------------------
-- 왜 GitHub Actions 의 schedule 을 쓰지 않나
-- ---------------------------------------------------------------------------
-- schedule 은 GitHub 의 큐 사정에 따라 밀린다. 2026-09-25 ~ 10-04 실측으로
-- 22:00 UTC(07:00 KST) 예약이 00:24 ~ 01:57 UTC(09:24 ~ 10:57 KST)에 시작했다 —
-- 2.5 ~ 4 시간 지연. 정각을 피한 :10 · :20 예약도 똑같이 늦었다.
--
-- workflow_dispatch(API 호출)는 그 큐를 타지 않고 바로 돈다. 그래서 시계는
-- 여기(pg_cron)에 두고, GitHub 에는 "지금 돌려라" 만 보낸다. GitHub schedule 은
-- 백업으로 sync-watchdog.yml 한 곳에만 남는다.
--
-- ---------------------------------------------------------------------------
-- 이 파일이 하는 일
-- ---------------------------------------------------------------------------
--   1. pg_cron · pg_net 확장을 켠다.
--   2. ops 스키마에 dispatch_sync_workflow(workflow) 를 만든다. Vault 의 토큰으로
--      GitHub 의 workflow_dispatch API 를 부른다. API 에 노출되지 않는 스키마이고
--      anon · authenticated 는 들어오지 못한다.
--   3. cron 잡 6개를 등록한다 (아래 표). 이름이 같으면 덮어쓰므로 다시 돌려도 된다.
--   4. 결과를 스스로 확인한다.
--
-- ---------------------------------------------------------------------------
-- 토큰은 이 파일에 없다
-- ---------------------------------------------------------------------------
-- 운영자가 SQL Editor 에서 한 번 넣는다 (docs/GITHUB_ACTIONS_SETUP.md 4절).
--
--   select vault.create_secret('<GitHub PAT>', 'github_dispatch_token');
--   select vault.create_secret('swpark3179/ai-news-letter', 'github_dispatch_repo');
--
-- PAT 는 fine-grained · 이 저장소 하나 · Actions: Read and write.
-- 둘 중 하나라도 없으면 함수는 경고만 남기고 아무것도 보내지 않는다 — 새 프로젝트나
-- 포크에서 ALL_MIGRATIONS.sql 을 돌려도 남의 저장소를 깨우지 않는다.
--
-- ---------------------------------------------------------------------------
-- 실패는 어디서 보이나
-- ---------------------------------------------------------------------------
-- net.http_post 는 요청을 큐에 넣고 바로 돌아온다. 그래서 cron.job_run_details 는
-- GitHub 이 401 · 404 · 422 를 돌려줘도 succeeded 로 남는다. 실제 응답은
-- net._http_response 에 6시간 동안 남는다 — 정상은 204. VERIFY.sql ㉒~㉕.
-- ---------------------------------------------------------------------------

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create schema if not exists ops;
comment on schema ops is
  '운영 잡(pg_cron)이 부르는 함수 (0022). PostgREST 가 노출하지 않고 anon · authenticated 는 접근하지 못한다.';
revoke all on schema ops from public, anon, authenticated;

-- security invoker: cron 은 잡을 등록한 postgres 권한으로 돈다. postgres 는 이미
-- vault · net 에 닿으므로 definer 로 권한을 빌려 올 이유가 없다.
create or replace function ops.dispatch_sync_workflow(workflow text)
returns bigint
language plpgsql
security invoker
set search_path = ''
as $$
declare
  token      text;
  repo       text;
  request_id bigint;
begin
  -- 이 세 개만 깨운다. 이름을 받는 함수가 아무 워크플로나 돌리게 두지 않는다.
  if workflow is null
     or workflow not in ('sync-geeknews.yml', 'sync-trend-openai.yml', 'sync-hada-show.yml') then
    raise exception 'dispatch_sync_workflow: 허용하지 않는 워크플로 %', workflow;
  end if;

  select s.decrypted_secret into token
    from vault.decrypted_secrets s
   where s.name = 'github_dispatch_token';
  select s.decrypted_secret into repo
    from vault.decrypted_secrets s
   where s.name = 'github_dispatch_repo';

  -- notice 는 cron 잡 안에서 어디에도 남지 않는다. warning 은 Postgres 로그에 남는다.
  if coalesce(token, '') = '' or coalesce(repo, '') = '' then
    raise warning 'dispatch_sync_workflow: Vault 에 github_dispatch_token · github_dispatch_repo 가 없어 % 를 건너뛴다', workflow;
    return null;
  end if;

  -- User-Agent 는 pg_net 이 붙이고(GitHub API 가 요구한다), Content-Type 도
  -- http_post 가 application/json 으로 채운다. 여기서 또 넣으면 헤더가 겹친다.
  -- inputs 는 보내지 않는다 — 워크플로 파일의 기본값(limit=30 등)이 쓰인다.
  select net.http_post(
           url                  := format('https://api.github.com/repos/%s/actions/workflows/%s/dispatches',
                                          repo, workflow),
           body                 := jsonb_build_object('ref', 'main'),
           headers              := jsonb_build_object(
                                     'Authorization',        'Bearer ' || token,
                                     'Accept',               'application/vnd.github+json',
                                     'X-GitHub-Api-Version', '2022-11-28'),
           timeout_milliseconds := 10000)
    into request_id;

  return request_id;
end;
$$;

comment on function ops.dispatch_sync_workflow(text) is
  '수집 워크플로 하나를 workflow_dispatch 로 깨운다 (0022). 반환값은 net._http_response 의 id.';

revoke all on function ops.dispatch_sync_workflow(text) from public, anon, authenticated;

-- pg_net 을 켜면 Supabase 가 anon · authenticated 에게 net.http_* 실행 권한을 준다.
-- net 은 PostgREST 가 노출하는 스키마가 아니라 밖에서 부를 길은 없지만, 0018 의
-- 원칙(anon 에게는 모바일 뷰 5개의 SELECT 뿐)에 맞춰 거둔다. 소유자가 supabase_admin
-- 이라 거두지 못하면 Postgres 가 WARNING 만 내고 넘어간다 — 아래 확인도 경고로 둔다.
revoke usage on schema net from anon, authenticated;
revoke execute on all functions in schema net from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 잡 등록. 시각은 UTC 다 (pg_cron 기본값). KST 는 서머타임이 없어 고정 9시간 차다.
--
--   잡 이름                  KST     UTC cron       워크플로
--   sync-geeknews-0700       07:00   0 22 * * *     sync-geeknews.yml
--   sync-trend-0710          07:10   10 22 * * *    sync-trend-openai.yml
--   sync-showcase-0720       07:20   20 22 * * *    sync-hada-show.yml
--   sync-geeknews-1130       11:30   30 2 * * *     sync-geeknews.yml
--   sync-trend-1140          11:40   40 2 * * *     sync-trend-openai.yml
--   sync-showcase-1150       11:50   50 2 * * *     sync-hada-show.yml
--
-- 10분 간격을 지키는 이유: 긱뉴스와 쇼케이스는 둘 다 news.hada.io 를 긁는다.
-- 같은 분에 돌면 403 을 맞을 수 있다. 트렌드는 그 사이에 둔다.
--
-- 점심 회차는 12시 전에 끝나도록 11:30 에 시작한다. arXiv 는 00:00 UTC(09:00 KST)에
-- 새 논문을 내므로 그날 논문은 이 회차가 가져온다.
-- ---------------------------------------------------------------------------
do $$
declare
  j record;
begin
  for j in
    select *
      from (values
        ('sync-geeknews-0700', '0 22 * * *',  'sync-geeknews.yml'),
        ('sync-trend-0710',    '10 22 * * *', 'sync-trend-openai.yml'),
        ('sync-showcase-0720', '20 22 * * *', 'sync-hada-show.yml'),
        ('sync-geeknews-1130', '30 2 * * *',  'sync-geeknews.yml'),
        ('sync-trend-1140',    '40 2 * * *',  'sync-trend-openai.yml'),
        ('sync-showcase-1150', '50 2 * * *',  'sync-hada-show.yml')
      ) as t(name, schedule, workflow)
  loop
    perform cron.schedule(
      j.name,
      j.schedule,
      format('select ops.dispatch_sync_workflow(%L)', j.workflow));
  end loop;
end $$;

-- 스스로 확인한다. SQL Editor · apply_migration 은 파일 하나를 한 트랜잭션으로 돌리므로
-- 예외가 나면 위의 것까지 전부 되돌아간다. Vault 비밀값은 여기서 요구하지 않는다 —
-- 토큰을 넣기 전에 이 파일부터 돌려도 되게.
do $$
declare
  missing text;
  -- 시그니처가 버전마다 다를 수 있어 to_regprocedure 로 찾는다. 못 찾으면 null —
  -- 문자열을 바로 has_function_privilege 에 넘기면 그 자리에서 예외가 난다.
  http_post regprocedure := to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)');
begin
  -- 1. 잡 6개가 기대한 시각 · 명령으로 켜져 있다.
  select string_agg(e.name, ', ')
    into missing
    from (values
      ('sync-geeknews-0700', '0 22 * * *',  'sync-geeknews.yml'),
      ('sync-trend-0710',    '10 22 * * *', 'sync-trend-openai.yml'),
      ('sync-showcase-0720', '20 22 * * *', 'sync-hada-show.yml'),
      ('sync-geeknews-1130', '30 2 * * *',  'sync-geeknews.yml'),
      ('sync-trend-1140',    '40 2 * * *',  'sync-trend-openai.yml'),
      ('sync-showcase-1150', '50 2 * * *',  'sync-hada-show.yml')
    ) as e(name, schedule, workflow)
   where not exists (
     select 1
       from cron.job c
      where c.jobname  = e.name
        and c.schedule = e.schedule
        and c.active
        and c.command  = format('select ops.dispatch_sync_workflow(%L)', e.workflow));
  if missing is not null then
    raise exception 'cron 잡이 기대와 다르다: %', missing;
  end if;

  -- 2. 함수가 있고, anon · authenticated 는 부르지 못한다.
  if to_regprocedure('ops.dispatch_sync_workflow(text)') is null then
    raise exception 'ops.dispatch_sync_workflow(text) 가 없다';
  end if;
  if has_schema_privilege('anon', 'ops', 'USAGE')
     or has_schema_privilege('authenticated', 'ops', 'USAGE')
     or has_function_privilege('anon', 'ops.dispatch_sync_workflow(text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'ops.dispatch_sync_workflow(text)', 'EXECUTE') then
    raise exception 'ops 스키마나 dispatch_sync_workflow 에 anon · authenticated 권한이 남아 있다';
  end if;

  -- 3. net.http_post 권한은 경고만 한다 (위 revoke 주석).
  if http_post is null then
    raise warning 'net.http_post(text,jsonb,jsonb,jsonb,integer) 를 찾지 못했다 — pg_net 버전을 확인하세요';
  -- 함수 EXECUTE 는 PUBLIC 에서 물려받기도 하므로 스키마 USAGE 와 함께 봐야 실제로
  -- 부를 수 있는지가 나온다.
  elsif has_schema_privilege('anon', 'net', 'USAGE')
        and has_function_privilege('anon', http_post, 'EXECUTE') then
    raise warning 'anon 이 아직 net.http_post 를 실행할 수 있다 — net 은 노출 스키마가 아니라 밖에서 부를 길은 없다';
  end if;
end $$;
