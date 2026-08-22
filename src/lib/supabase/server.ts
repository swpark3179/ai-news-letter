import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseEnv } from "@/lib/env";

/**
 * service_role 키를 쓰는 서버 전용 Supabase 클라이언트.
 *
 * RLS 를 켜 두고 정책은 만들지 않았으므로(0007_rls.sql) 이 클라이언트만이
 * 데이터에 접근할 수 있다. 브라우저 번들에 절대 들어가면 안 되기 때문에
 * "server-only" 를 import 해 클라이언트 컴포넌트에서 참조하면 빌드가 깨지게 한다.
 */

let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(supabaseEnv.url, supabaseEnv.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "ai-newsletter" } },
  });
  return cached;
}
