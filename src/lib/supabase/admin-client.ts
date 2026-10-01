import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Node 스크립트(scripts/sync/*)에서 쓰는 Supabase 클라이언트.
 *
 * service_role 키로 표에 쓴다. 웹은 이 키를 쓰지 않는다 (lib/supabase/read.ts 의 anon 키).
 * "server-only" 를 import 하지 않는다 — 그 패키지는 Next 번들러 밖(순수 tsx 실행)에서는
 * 동작하지 않기 때문이다.
 */

/** src/lib/env.ts 의 normalizeSupabaseUrl 과 같은 규칙. */
function normalizeUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/(rest|auth|storage|realtime|functions)\/v\d+\/?$/i, "")
    .replace(/\/+$/, "");
}

export function createAdminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다. .env.local 또는 GitHub Secrets 를 확인하세요.",
    );
  }
  return createClient(normalizeUrl(url), key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-application-name": "ai-newsletter-sync" } },
  });
}
