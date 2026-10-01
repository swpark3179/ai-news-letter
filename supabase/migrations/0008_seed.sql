-- 0008_seed.sql
-- 초기 데이터. 여러 번 실행해도 안전하도록 idempotent 하게 작성한다.
--
-- 발행 호수 하나만 심는다. mobile_issue 뷰(0013)가 이 값을 기준으로 오늘의 호수를
-- 계산한다.
--
-- 예전에는 구성원 명부(members) · 발표 순번(rotations) 시드와 지면 머리 · 푸터용 설정이
-- 함께 있었다. 로그인 · 관리자 · 모임 기능을 걷어 내면서(2단계) 읽는 곳이 없어졌고,
-- 표는 0020 이 graveyard 로 옮기므로 여기서도 지웠다.

insert into public.app_settings (key, value) values
  ('issue_no', '128'::jsonb)
on conflict (key) do nothing;
