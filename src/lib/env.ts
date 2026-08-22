/**
 * 환경변수 접근을 한 곳에 모은다.
 *
 * 브라우저로 나가는 값은 NEXT_PUBLIC_ 접두사가 붙은 것뿐이다.
 * Supabase 키·SSO 복호화 키는 서버에서만 읽는다 (requireServerEnv 사용).
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

function optionalEnv(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

// --- Supabase (서버 전용) -------------------------------------------------

/**
 * 아직 채워지지 않은 Supabase 환경변수 목록.
 *
 * 셋업 전에는 예외 대신 안내 화면을 보여 주기 위해, 페이지가 렌더 전에 이 값을
 * 먼저 확인한다. 빈 배열이면 설정이 끝난 것이다.
 */
export function missingSupabaseEnv(): string[] {
  return ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter(
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
  get serviceRoleKey() {
    return requireServerEnv("SUPABASE_SERVICE_ROLE_KEY");
  },
  /** 발표 자료·사진을 올릴 Storage 버킷 */
  get bucket() {
    return optionalEnv("SUPABASE_STORAGE_BUCKET", "newsletter");
  },
};

// --- 세션 (서버 전용) -----------------------------------------------------

export const sessionEnv = {
  get secret() {
    // 개발 편의를 위해 기본값을 두되, 운영에서는 반드시 지정해야 한다.
    const v = process.env.SESSION_SECRET;
    if (v) return v;
    if (process.env.NODE_ENV === "production") {
      throw new Error("운영 환경에서는 SESSION_SECRET 을 반드시 설정해야 합니다.");
    }
    return "dev-only-insecure-session-secret-change-me-please-32b";
  },
  cookieName: "ainl_session",
  guestCookieName: "ainl_guest",
  /** 8시간 */
  maxAgeSec: 60 * 60 * 8,
};

// --- SSO (서버 전용) ------------------------------------------------------

export const ssoServerEnv = {
  /** 사내 페이로드 복호화 키. mock 모드에서는 쓰이지 않는다. */
  get decodeKey() {
    return optionalEnv("SSO_DECODE_KEY");
  },
};

// --- SSO (클라이언트 노출) ------------------------------------------------
//
// NEXT_PUBLIC_ 값은 번들에 인라인되므로 process.env.X 를 통째로 읽으면 안 되고
// 리터럴로 참조해야 한다.

export type SsoMode = "mock" | "real";

export const ssoPublicEnv = {
  mode: (process.env.NEXT_PUBLIC_SSO_MODE === "real" ? "real" : "mock") as SsoMode,
  trayWsUrl: process.env.NEXT_PUBLIC_SSO_TRAY_WS_URL ?? "",
};

// --- LLM (서버/스크립트 전용) --------------------------------------------

export const llmEnv = {
  get provider(): "gemini" | "openai" {
    return process.env.LLM_PROVIDER === "openai" ? "openai" : "gemini";
  },
  get geminiApiKey() {
    return requireServerEnv("GEMINI_API_KEY");
  },
  get geminiModel() {
    return optionalEnv("GEMINI_MODEL", "gemini-2.5-flash");
  },
  get openaiApiKey() {
    return requireServerEnv("OPENAI_API_KEY");
  },
  get openaiModel() {
    return optionalEnv("OPENAI_MODEL", "gpt-5-mini");
  },
  /**
   * Gemini 무료 티어는 gemini-2.5-flash 기준 10 RPM 이다.
   * 호출 사이에 이 간격을 둬서 429 를 피한다.
   */
  get minCallIntervalMs() {
    const raw = Number(process.env.LLM_MIN_CALL_INTERVAL_MS);
    if (Number.isFinite(raw) && raw >= 0) return raw;
    return process.env.LLM_PROVIDER === "openai" ? 500 : 7000;
  },
};

// --- 수집 스크립트 --------------------------------------------------------

export const syncEnv = {
  /** 긱뉴스에서 몇 일 전까지 긁어올지 */
  get geekLookbackDays() {
    const n = Number(process.env.GEEK_LOOKBACK_DAYS);
    return Number.isFinite(n) && n > 0 ? n : 3;
  },
  get geekMaxPages() {
    const n = Number(process.env.GEEK_MAX_PAGES);
    return Number.isFinite(n) && n > 0 ? n : 8;
  },
  /** 트렌드 브리핑 1회 실행당 새로 기사화할 최대 건수 */
  get trendMaxNew() {
    const n = Number(process.env.TREND_MAX_NEW);
    return Number.isFinite(n) && n > 0 ? n : 30;
  },
  /** HN 에서 선별할 최소 점수 */
  get hnMinScore() {
    const n = Number(process.env.HN_MIN_SCORE);
    return Number.isFinite(n) && n > 0 ? n : 150;
  },
  /** GitHub API 레이트리밋 완화용 (선택) */
  get githubToken() {
    return optionalEnv("GITHUB_TOKEN");
  },
  userAgent: optionalEnv(
    "SYNC_USER_AGENT",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 AINewsletterBot/1.0",
  ),
};

export const KST_TZ = "Asia/Seoul";
