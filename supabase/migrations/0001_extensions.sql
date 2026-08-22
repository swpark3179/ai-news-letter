-- 0001_extensions.sql
-- gen_random_uuid() 를 쓰기 위한 확장. Supabase 프로젝트에는 보통 이미 켜져 있다.

create extension if not exists pgcrypto with schema extensions;
