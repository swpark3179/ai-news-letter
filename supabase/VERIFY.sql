-- =============================================================================
-- 적용 확인용 쿼리
-- ALL_MIGRATIONS.sql 을 실행한 뒤 이 파일을 SQL Editor 에 붙여넣고 Run 하세요.
-- 마지막 SELECT 의 결과만 표시되므로, 한 블록씩 끊어서 실행하는 편이 편합니다.
-- =============================================================================

-- ① public 의 테이블
--    기대 (0020 이후): app_settings, geek_news, hada_contents, showcase_items,
--                     sync_runs, trend_items
--    운영 DB 에는 collector_receipts · collector_transfers · collector_trend_pending 이
--    더 있다 (LIVE_ONLY.md B). 0020 이 graveyard 로 옮긴 표는 ㉑ 에서 본다.
select table_name
  from information_schema.tables
 where table_schema = 'public'
   and table_type = 'BASE TABLE'
 order by table_name;


-- ② RLS 가 public 테이블 전부 켜져 있는가 (rowsecurity 가 모두 true 여야 함)
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
 order by tablename;


-- ③ 정책이 하나도 없는 것이 정상
--    기대: 0 rows
--
--    표에 직접 닿을 수 있는 것은 service_role 뿐이다. 0013 이후로 anon 도 읽는
--    것이 생겼지만, 그건 표가 아니라 뷰 3개이고 정책이 아니라 grant 로 열려 있다
--    (아래 ⑪⑫⑬). 그래서 여기는 여전히 0 rows 여야 한다.
select schemaname, tablename, policyname
  from pg_policies
 where schemaname = 'public';


-- ④ 인덱스가 만들어졌는가 (0020 이후 9개 — 운영은 collector 인덱스가 더 있다)
--    scraps · 모바일 로그인 인덱스는 표를 따라 graveyard 로 옮겨 갔다.
select tablename, indexname
  from pg_indexes
 where schemaname = 'public'
   and indexname not like '%_pkey'
 order by tablename, indexname;


-- ⑤ trend_items.public_id 가 generated column 으로 잡혔는가
--    기대: is_generated = ALWAYS
select column_name, is_generated, generation_expression
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'trend_items'
   and column_name = 'public_id';


-- ⑥ (0020 이후 없음) 유닛원 시드 — members 는 graveyard 로 옮겨 갔다 (㉑).


-- ⑦ 발행 설정 — 0021 이후 issue_no 1건 (mobile_issue 가 읽는다)
select key, value from public.app_settings order by key;


-- ⑧ (0020 이후 없음) 로테이션 시드 — rotations 는 graveyard 로 옮겨 갔다 (㉑).


-- ⑨ Storage 버킷
--    기대 (5단계 이후): 0 rows. 기사 사진을 올리던 newsletter 버킷은 쓰는 곳이 없어
--    대시보드(Storage)에서 지운다 — SQL 로는 지울 수 없다(storage.protect_delete).
select id, name, public, file_size_limit from storage.buckets;


-- ⑩ (0020 이후 없음) members.epid — members 는 graveyard 로 옮겨 갔다 (㉑).


-- ⑪ 모바일 읽기 뷰 5개가 만들어졌는가 (0013 · 0016 · 0017)
--    기대: mobile_feed, mobile_hada_content, mobile_issue, mobile_showcase,
--          mobile_trend_detail
select table_name
  from information_schema.views
 where table_schema = 'public'
   and table_name like 'mobile%'
 order by table_name;


-- ⑫ anon 이 읽을 수 있는 것이 그 다섯 뷰뿐인가 (0018)  ← 이 파일에서 제일 중요한 항목
--
--    기대: 정확히 5행. ⑪ 의 다섯 뷰 각각의 SELECT.
--
--    **여기에 그 밖의 것이 보이면 즉시 회수하세요.** anon 키는 앱 바이너리에 실려
--    있어 사실상 공개된 값이다. 이 목록에 geek_news 같은 원본 표가 있으면 숨긴
--    항목까지 새고, 사용자 정보가 든 표가 있으면 그 내용이 통째로 공개된다.
--
--      revoke all on public.<표 이름> from anon;
--
--    SELECT 말고 INSERT · UPDATE · DELETE 가 보이는 것도 같은 뜻이다. 실제로 그랬다 —
--    Supabase 의 기본 권한이 새 뷰를 anon 에게 통째로 열어 두었고, 단순 뷰 셋은
--    쓰기 가능한 뷰라 그 길로 원본 표를 고치거나 지울 수 있었다. 0018 이 닫았다.
--    다시 보이면 0018 을 한 번 더 실행하세요 (몇 번을 돌려도 같은 상태가 됩니다).
select table_name, privilege_type
  from information_schema.role_table_grants
 where grantee = 'anon'
 order by table_name, privilege_type;

--    함수도 같은 눈으로 본다. 기대: 0 rows.
--    security definer 함수는 소유자 권한으로 돌아서, anon 이 실행할 수 있으면
--    /rest/v1/rpc/<이름> 이 그대로 뒷문이 된다.
select p.oid::regprocedure as anon_이_실행할_수_있는_definer_함수
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.prosecdef
   and has_function_privilege('anon', p.oid, 'EXECUTE');


-- ⑬ anon 으로 실제 읽어 본다 (0013)
--
--    ⑫ 가 목록이라면 이건 실물 확인이다. **세 번째 줄부터는 실패하는 것이 정상**이라
--    한 줄씩 끊어서 실행하세요 — 한꺼번에 돌리면 첫 실패에서 멈춥니다.
--
--    explain 은 권한 검사까지만 하고 실제로 지우지 않으므로 운영 DB 에서 돌려도 됩니다.
--
--    set role anon; select count(*) from public.mobile_feed;          -- 행 수가 나와야 정상
--    set role anon; select * from public.mobile_issue;                -- 한 행이 나와야 정상
--    set role anon; explain delete from public.mobile_trend_detail where key = '-';  -- permission denied 가 정상
--    set role anon; explain update public.mobile_showcase set title = title;          -- permission denied 가 정상
--    set role anon; select count(*) from public.geek_news;            -- permission denied 가 정상
--    set role anon; select count(*) from public.trend_items;          -- permission denied 가 정상
--    set role anon; select count(*) from public.scraps;               -- permission denied 가 정상
--    set role anon; select count(*) from public.members;              -- permission denied 가 정상
--    reset role;


-- ⑭ 뷰가 숨긴 항목을 걸러 내는가 (0013)
--    기대: 두 값이 0. 뷰 정의의 is_hidden / status 필터가 살아 있는지 본다.
select
  (select count(*) from public.mobile_feed f
     join public.geek_news g on g.url = f.key
    where f.type = 'geek' and g.is_hidden)                        as 숨긴_긱뉴스가_샌_건수,
  (select count(*) from public.mobile_feed f
     join public.trend_items t on t.source_url = f.key
    where f.type = 'trend' and t.status <> 'published')           as 미공개_트렌드가_샌_건수;


-- ⑮ 앱이 볼 최신 상태 (0013)
--    수집이 돌고 있다면 date 가 오늘이어야 한다. 앱 홈 마스트헤드에 그대로 뜬다.
select * from public.mobile_issue;


-- ⑯ 본문 저장소가 만들어졌는가 (0015)
--    기대: hada_contents 한 행, rowsecurity = true.
--    anon 권한은 ⑫ 목록에 나타나면 안 된다 — 앱은 표가 아니라 0017 의
--    mobile_hada_content 뷰로 본문을 읽는다.
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
   and tablename = 'hada_contents';


-- ⑰ 본문 수집이 실제로 되고 있는가 (0015)
--
--    수집을 한 번이라도 돌린 뒤에 본다.
--      status = 'ok'           본문을 얻었다 — 대부분 여기여야 한다
--      status = 'parse_failed' 본문 컨테이너를 못 찾았다
--
--    parse_failed 가 눈에 띄게 많으면 상세 페이지 마크업이 바뀐 것이다.
--    sources/hada-topic.ts 의 BODY_SELECTORS 를 다시 실측하세요
--    (GitHub Actions 의 "긱뉴스 상세 구조 진단" 워크플로).
select source,
       status,
       count(*)                       as 건수,
       round(avg(body_chars))         as 평균_글자수,
       max(body_chars)                as 최대_글자수,
       sum(truncated::int)            as 상한에_걸린_건수
  from public.hada_contents
 group by source, status
 order by source, status;


-- ⑱ 본문 저장소가 얼마나 커졌는가 (0015)
--    TOAST 압축까지 반영된 실제 크기다. 연 20~25MB 안팎을 예상한다.
select pg_size_pretty(pg_total_relation_size('public.hada_contents')) as 본문_저장소_크기;


-- ⑲ 아직 본문이 없는 항목이 얼마나 남았는가 (0015)
--    수집을 처음 켠 뒤에는 크지만, 실행마다 예산(HADA_CONTENT_MAX_PER_RUN)만큼
--    줄어들어야 한다. 며칠 지나도 안 줄면 로그에서 실패 사유를 보세요.
select 'geeknews' as source, count(*) as 본문_없는_항목
  from public.geek_news g
  left join public.hada_contents c on c.url = g.url and c.status = 'ok'
 where c.url is null
union all
select 'showcase', count(*)
  from public.showcase_items s
  left join public.hada_contents c on c.url = s.url and c.status = 'ok'
 where c.url is null;


-- ⑳ 웹이 읽는 열이 뷰 끝에 붙었는가 (0019)
--    기대: 3행.
--      mobile_feed          … search_text, collected_date, score, origin_url
--      mobile_showcase      … search_text, collected_date, score
--      mobile_trend_detail  … tags, collected_date, origin_url
--    앞쪽 열(앱이 읽는 것)의 이름 · 순서는 0013 · 0016 과 같아야 한다.
select c.relname,
       string_agg(a.attname, ', ' order by a.attnum) as 열
  from pg_class c
  join pg_attribute a on a.attrelid = c.oid and a.attnum > 0
 where c.relnamespace = 'public'::regnamespace
   and c.relname in ('mobile_feed', 'mobile_showcase', 'mobile_trend_detail')
 group by c.relname
 order by c.relname;


-- ㉑ 안 쓰는 표 · 함수가 graveyard 로 옮겨졌는가 (0020)
--    기대: public 쪽 0 rows.
--          graveyard 쪽 표 12개(새 프로젝트) · 14개 + 함수 9개(운영 — LIVE_ONLY.md A 포함).
--    public 에 같은 이름이 다시 보이면 ALL_MIGRATIONS.sql 을 다시 돌려 0002 등이 빈 표를
--    새로 만든 것이다. graveyard 쪽이 원래 데이터다.
select n.nspname as 스키마, c.relname as 표
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where c.relkind = 'r'
   and n.nspname in ('public', 'graveyard')
   and c.relname in ('members', 'articles', 'article_sources', 'comments', 'meetings',
                     'meeting_attendees', 'rotations', 'scraps', 'attachments',
                     'member_google_identities', 'member_refresh_tokens',
                     'member_apple_identities', 'allowed_social_identities',
                     'member_auth_accounts')
 order by 1, 2;

select p.oid::regprocedure as graveyard_함수
  from pg_proc p
 where p.pronamespace = 'graveyard'::regnamespace
 order by 1;

--    기대: false · false — 앱 · 웹의 키로는 graveyard 에 들어오지 못한다.
select has_schema_privilege('anon', 'graveyard', 'USAGE')          as anon_접근,
       has_schema_privilege('authenticated', 'graveyard', 'USAGE') as authenticated_접근;
