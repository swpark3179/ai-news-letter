-- 0007_rls.sql
-- RLS 정책.
--
-- 이 서비스는 Supabase Auth 를 쓰지 않는다. 로그인은 사내 SSO 이고, 브라우저에는
-- Supabase 키를 일절 내려보내지 않는다. 모든 DB 접근은 Next.js 서버가
-- service_role 키로 수행한다.
--
-- 따라서 "RLS 를 켜고 정책은 하나도 만들지 않는" 구성이 맞다.
--   - service_role 은 RLS 를 우회하므로 서버 코드는 정상 동작한다.
--   - anon / authenticated 롤은 정책이 없으므로 모든 접근이 거부된다.
--     (anon 키가 유출되거나 실수로 클라이언트에서 호출해도 사내 콘텐츠가 새지 않는다)
--
-- 나중에 클라이언트 직접 조회가 필요해지면 그때 select 정책을 명시적으로 추가한다.

alter table public.members           enable row level security;
alter table public.app_settings      enable row level security;
alter table public.geek_news         enable row level security;
alter table public.trend_items       enable row level security;
alter table public.articles          enable row level security;
alter table public.article_sources   enable row level security;
alter table public.comments          enable row level security;
alter table public.meetings          enable row level security;
alter table public.meeting_attendees enable row level security;
alter table public.rotations         enable row level security;
alter table public.scraps            enable row level security;
alter table public.sync_runs         enable row level security;
alter table public.attachments       enable row level security;

-- anon / authenticated 롤에 남아 있을 수 있는 기본 권한도 회수해 둔다.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;
