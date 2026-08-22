-- 0009_scraps.sql
-- 보관함(스크랩) 조회용 인덱스.
--
-- 테이블 자체는 0004_unit.sql 에 이미 있다. 화면이 붙으면서 생긴 조회 패턴은
-- 세 가지다.
--   1) 내 보관함        member_id + 최근 보관순        → scraps_member_created_idx
--   2) 목록의 보관 여부  (member_id, target_type, target_key) 다건 → PK 인덱스로 처리
--   3) 관리자 통계      (target_type, target_key) 로 묶어 세기 → scraps_target_idx

create index if not exists scraps_member_created_idx
  on public.scraps (member_id, created_at desc);

create index if not exists scraps_target_idx
  on public.scraps (target_type, target_key);

comment on table public.scraps is
  '사용자가 나중에 다시 읽으려고 보관해 둔 게시물. 목록은 본인만 보고, 집계는 관리자 화면에서만 본다.';
