import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/env";

/**
 * 웹이 쓰는 Supabase 클라이언트 — 모바일 앱과 같은 anon 키다.
 *
 * anon 에게 열린 것은 뷰 5개의 SELECT 뿐이라(0018_lock_anon_grants.sql) 이 클라이언트로는
 * 표에 닿지도, 무엇을 쓰지도 못한다. 공개 키라 브라우저에 나가도 문제는 없지만, 서버
 * 컴포넌트에서만 읽으므로 server-only 로 묶어 둔다.
 *
 * service_role 키는 수집 스크립트(scripts/sync → lib/supabase/admin-client.ts)만 쓴다.
 */

let cached: SupabaseClient | null = null;

export function supabaseRead(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(supabaseEnv.url, supabaseEnv.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "ai-newsletter-web" } },
  });
  return cached;
}
