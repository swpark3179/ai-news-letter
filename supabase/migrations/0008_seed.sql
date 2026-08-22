-- 0008_seed.sql
-- 초기 데이터. 여러 번 실행해도 안전하도록 전부 idempotent 하게 작성한다.
-- 사번은 임시값이므로 실제 운영 전에 교체할 것.

-- ---------------------------------------------------------------------------
-- 발행 설정 (디자인의 props 3종)
-- ---------------------------------------------------------------------------
insert into public.app_settings (key, value) values
  ('issue_no',           '128'::jsonb),
  ('publisher',          '"Samsung SDS · AI Unit"'::jsonb),
  ('show_en_subtitles',  'true'::jsonb),
  ('publish_hour_label', '"07:00 KST 발행"'::jsonb),
  ('security_notice',    '"사내 문서 보안 등급 II · 외부 공유 금지"'::jsonb)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 유닛원 (디자인 AV 맵의 4명)
-- ---------------------------------------------------------------------------
insert into public.members (emp_no, name, role, is_admin, initial, avatar_tone, dept) values
  ('21084213', '박세원', 'unit_lead',  true,  '세원', 'purple', 'AI Unit'),
  ('21084214', '문명훈', 'member',     true,  '명훈', 'blue',   'AI Unit'),
  ('21084215', '박미숙', 'member',     true,  '미숙', 'green',  'AI Unit'),
  ('21084216', '한솔아', 'member',     true,  '솔아', 'yellow', 'AI Unit')
on conflict (emp_no) do nothing;

-- 구독자 예시 (디자인의 READER)
insert into public.members (emp_no, name, role, is_admin, initial, avatar_tone, dept) values
  ('21099001', '김도현', 'subscriber', false, '도현', 'gray', 'AI Unit 구독')
on conflict (emp_no) do nothing;

-- ---------------------------------------------------------------------------
-- 심층 분석 발표 순번 (월 1회, 4주 주기)
-- ---------------------------------------------------------------------------
insert into public.rotations (kind, member_id, period_label, period_start, status)
select 'deep', m.id, v.period_label, v.period_start::date, v.status
from (values
  ('박세원', '8월 · 완료',  '2026-08-19', 'done'),
  ('문명훈', '9월 16일',    '2026-09-16', 'preparing'),
  ('박미숙', '10월 14일',   '2026-10-14', 'planned'),
  ('한솔아', '11월 11일',   '2026-11-11', 'planned')
) as v(name, period_label, period_start, status)
join public.members m on m.name = v.name
where not exists (
  select 1 from public.rotations r
  where r.kind = 'deep' and r.member_id = m.id and r.period_start = v.period_start::date
);

-- ---------------------------------------------------------------------------
-- 이번 주 주간 리뷰 당번
-- ---------------------------------------------------------------------------
insert into public.rotations (kind, member_id, period_label, period_start, topic, status)
select 'weekly', m.id, v.period_label, v.period_start::date, v.topic, v.status
from (values
  ('박세원', '8월 3주차', '2026-08-17', 'agent-lightning 리뷰',   'done'),
  ('문명훈', '8월 3주차', '2026-08-17', 'vLLM 스케줄러 PR',        'done'),
  ('박미숙', '8월 3주차', '2026-08-17', '리랭커 비교 실험',        'done'),
  ('한솔아', '8월 3주차', '2026-08-17', 'HN 도입 실패담 정리',     'reviewing')
) as v(name, period_label, period_start, topic, status)
join public.members m on m.name = v.name
where not exists (
  select 1 from public.rotations r
  where r.kind = 'weekly' and r.member_id = m.id and r.period_start = v.period_start::date
);
