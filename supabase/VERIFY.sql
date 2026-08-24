-- =============================================================================
-- 적용 확인용 쿼리
-- ALL_MIGRATIONS.sql 을 실행한 뒤 이 파일을 SQL Editor 에 붙여넣고 Run 하세요.
-- 마지막 SELECT 의 결과만 표시되므로, 한 블록씩 끊어서 실행하는 편이 편합니다.
-- =============================================================================

-- ① 테이블 16개가 모두 만들어졌는가
--    기대: app_settings, article_sources, articles, attachments, comments,
--          geek_news, meeting_attendees, meetings, member_apple_identities,
--          member_google_identities, member_refresh_tokens, members, rotations,
--          scraps, sync_runs, trend_items
select table_name
  from information_schema.tables
 where table_schema = 'public'
   and table_type = 'BASE TABLE'
 order by table_name;


-- ② RLS 가 16개 테이블 전부 켜져 있는가 (rowsecurity 가 모두 true 여야 함)
select tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
 order by tablename;


-- ③ 정책이 하나도 없는 것이 정상 (service_role 만 접근 가능한 구성)
--    기대: 0 rows
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
