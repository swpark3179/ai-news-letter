-- 0021_app_settings_trim.sql
-- app_settings 에서 issue_no 하나만 남긴다.
--
-- 예전 0008 이 심은 다섯 값 중 지금 읽히는 것은 issue_no 뿐이다 — mobile_issue 뷰(0013)가
-- 발행 호수를 계산할 때 쓴다. 나머지 넷(publisher · publish_hour_label · security_notice ·
-- show_en_subtitles)은 2단계에서 걷어 낸 웹 화면(지면 머리 · 푸터)이 읽던 값이라 읽는
-- 곳이 없다.
--
-- 지금의 0008 은 issue_no 만 심으므로 새 프로젝트에서는 지울 것이 없다. 예전 0008 로
-- 만든 DB(운영 포함)에서만 실제로 행이 지워진다.

delete from public.app_settings where key <> 'issue_no';

do $$
begin
  if not exists (select 1 from public.app_settings where key = 'issue_no') then
    raise exception 'app_settings.issue_no 가 없다 — mobile_issue 가 발행 호수를 계산하지 못한다';
  end if;
end $$;
