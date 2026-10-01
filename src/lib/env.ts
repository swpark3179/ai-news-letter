/**
 * 환경변수 접근을 한 곳에 모은다.
 *
 * 브라우저로 나가는 값은 없다. Supabase 키는 서버에서만 읽는다 (requireServerEnv 사용).
 *
 * 웹이 쓰는 키는 anon 하나다. service_role 키는 수집 스크립트만 쓰고, 그쪽은
 * lib/supabase/admin-client.ts 가 process.env 에서 직접 읽는다.
 */

function requireServerEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `환경변수 ${name} 가 설정되지 않았습니다. .env.local 또는 GitHub Secrets 를 확인하세요.`,
    );
  }
  return v;
}

// --- Supabase (서버 전용) -------------------------------------------------

/**
 * 아직 채워지지 않은 Supabase 환경변수 목록.
 *
 * 셋업 전에는 예외 대신 안내 화면을 보여 주기 위해, 페이지가 렌더 전에 이 값을
 * 먼저 확인한다. 빈 배열이면 설정이 끝난 것이다.
 */
export function missingSupabaseEnv(): string[] {
  return ["SUPABASE_URL", "SUPABASE_ANON_KEY"].filter(
    (k) => !process.env[k]?.trim(),
  );
}

/**
 * Supabase 프로젝트 URL 정규화.
 *
 * 대시보드에는 Project URL 말고도 REST 엔드포인트(`.../rest/v1/`)가 같이 노출돼
 * 있어서 그쪽을 복사하기 쉽다. supabase-js 는 `/rest/v1` 을 스스로 붙이므로
 * 경로가 두 번 들어가면 "Invalid path specified in request URL" 로 죽는다.
 * 흔한 실수라 여기서 걷어낸다.
 */
export function normalizeSupabaseUrl(raw: string): string {
  return raw
    .trim()
    .replace(/\/(rest|auth|storage|realtime|functions)\/v\d+\/?$/i, "")
    .replace(/\/+$/, "");
}

export const supabaseEnv = {
  get url() {
    return normalizeSupabaseUrl(requireServerEnv("SUPABASE_URL"));
  },
  /** 모바일 앱과 같은 anon 키 (publishable 키도 된다) */
  get anonKey() {
    return requireServerEnv("SUPABASE_ANON_KEY");
  },
};

// --- LLM (수집 스크립트 전용) ---------------------------------------------

/**
 * 어느 LLM 으로 트렌드 브리핑을 쓸지 정한다.
 *
 * LLM_PROVIDER 를 지정하면 그 값을 따르고, 비어 있으면 키가 등록된 쪽을 쓴다.
 * (정기 실행은 워크플로가 LLM_PROVIDER=openai 를 명시한다. 손으로 돌릴 때처럼
 *  값이 없는 경로에서 키 없는 제공자를 골라 실패하는 것을 막는다.)
 */
export function resolveLlmProvider(): "gemini" | "openai" {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (raw === "openai" || raw === "gemini") return raw;
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  return "openai";
}

export const KST_TZ = "Asia/Seoul";
