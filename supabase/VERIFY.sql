-- =============================================================================
-- 적용 확인용 쿼리
-- ALL_MIGRATIONS.sql 을 실행한 뒤 이 파일을 SQL Editor 에 붙여넣고 Run 하세요.
-- 마지막 SELECT 의 결과만 표시되므로, 한 블록씩 끊어서 실행하는 편이 편합니다.
-- =============================================================================

-- ① 테이블 17개가 모두 만들어졌는가
--    기대: app_settings, article_sources, articles, attachments, comments,
--          geek_news, meeting_attendees, meetings, member_apple_identities,
--          member_google_identities, member_refresh_tokens, members, rotations,
--          scraps, showcase_items, sync_runs, trend_items
select table_name
  from information_schema.tables
 where table_schema = 'public'
   and table_type = 'BASE TABLE'
 order by table_name;


-- ② RLS 가 17개 테이블 전부 켜져 있는가 (rowsecurity 가 모두 true 여야 함)
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


-- ④ 인덱스가 만들어졌는가 (21개 내외)
--    scraps 2개 + 모바일 로그인 6개(0010 의 4개 · 0011 의 2개) 포함
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


-- ⑥ 시드 — 유닛원 4명 + 구독자 1명
select emp_no, name, role, is_admin, initial, avatar_tone
  from public.members
 order by role, name;


-- ⑦ 시드 — 발행 설정 5건
select key, value from public.app_settings order by key;


-- ⑧ 시드 — 로테이션 8건 (심층 4 + 주간 4)
select kind, period_label, status, m.name
  from public.rotations r
  join public.members m on m.id = r.member_id
 order by kind, period_start;


-- ⑨ Storage 버킷이 만들어졌는가
--    기대: newsletter / public = false
select id, name, public, file_size_limit from storage.buckets;


-- ⑩ members.epid 컬럼과 부분 유니크 인덱스 (0012)
--    기대: epid / YES(nullable), members_epid_key
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'members'
   and column_name = 'epid';

select indexname, indexdef
  from pg_indexes
 where schemaname = 'public'
   and indexname = 'members_epid_key';


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
--    항목까지 새고, members 나 scraps 가 있으면 사내 사용자 정보와 개인 보관
--    내역이 통째로 공개된다.
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
