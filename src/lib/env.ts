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

/** 쉼표로 구분된 목록. 공백과 빈 항목은 버린다. */
function csvEnv(name: string): string[] {
  return optionalEnv(name)
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
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
  /** 8시간 — 웹 쿠키와 모바일 액세스 토큰이 같은 값을 쓴다 */
  maxAgeSec: 60 * 60 * 8,
  /**
   * 모바일 리프레시 토큰 수명. 이 기간 안에 앱을 한 번도 열지 않으면 다시 로그인한다.
   * 액세스 토큰과 달리 DB 에 남아 있어 폐기할 수 있으므로 길게 둔다.
   */
  refreshTtlDays: 60,
};

// --- SSO (서버 전용) ------------------------------------------------------

export const ssoServerEnv = {
  /**
   * 사내 페이로드 복호화 키 (SecuBase 의 SSO baseKey, 32바이트).
   *
   * Java 소스의 8진 이스케이프("\47\10\167…") 형태와 base64 를 모두 받는다
   * (src/lib/auth/sso/decode-knox.ts 의 decodeBaseKey). .env 에는 제어문자를
   * 그대로 담을 수 없으므로 base64 로 넣는 편이 안전하다.
   * mock 모드에서는 쓰이지 않는다.
   */
  get decodeKey() {
    return optionalEnv("SSO_DECODE_KEY");
  },

  /**
   * 처음 보는 EPID 를 자동으로 가입시킬지.
   *
   * 방침은 「등록된 사용자만 로그인한다」이므로 실 모드 기본값은 false 다.
   * 목업 모드에서는 개발 편의를 위해 기존 동작(첫 로그인에 구독자 생성)을 유지한다.
   */
  get autoCreateMembers(): boolean {
    const raw = process.env.SSO_ALLOW_AUTO_CREATE?.trim().toLowerCase();
    if (raw === "true" || raw === "1") return true;
    if (raw === "false" || raw === "0") return false;
    return ssoPublicEnv.mode === "mock";
  },

  /**
   * 무결성이 확인되지 않은 페이로드로 세션을 발급해도 되는지.
   *
   * SecuBase 규격을 아직 받지 못해 decode-knox.ts 가 「단순 인코딩」을 가정하고
   * 있다 — 즉 **위조를 막지 못한다.** userInfo 가 실제로 base64 평문이라면 누구든
   * 임의의 EPID 로 페이로드를 만들 수 있고, 등록사용자 대조를 통과하면 등록된
   * 아무 사람으로나 로그인된다.
   *
   * 그래서 개발·스테이징에서는 그대로 열어 두되(연동 확인이 목적), 운영 빌드에서는
   * 이 값을 명시적으로 1 로 두지 않는 한 실 모드 로그인을 거절한다. 규격을 받아
   * decode-knox.ts 를 채우고 나면 이 스위치는 제거한다.
   */
  get allowUnverifiedPayload(): boolean {
    if (process.env.NODE_ENV !== "production") return true;
    return process.env.SSO_ALLOW_UNVERIFIED_PAYLOAD === "1";
  },
};

// --- SSO 진단 (서버 전용) -------------------------------------------------

export const ssoDebugEnv = {
  /**
   * 진단 화면·API 를 여는 토큰.
   *
   * 로그인이 안 되는 상황을 진단하는 것이 목적이라, 세션을 요구하면 쓸 수 없다.
   * 그래서 운영에서는 이 토큰이 유일한 열쇠다. 비워 두면 운영에서 진단이 닫힌다.
   * `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
   */
  get token(): string {
    return optionalEnv("SSO_DEBUG_TOKEN").trim();
  },

  /** 토큰 없이도 열어 둘지 — 개발·스테이징에서만. */
  get openWithoutToken(): boolean {
    return process.env.NODE_ENV !== "production";
  },
};

/**
 * 프로세스가 **지금** 가진 환경변수 값을 읽는다.
 *
 * `process.env.NEXT_PUBLIC_X` 처럼 리터럴로 쓰면 Next 가 빌드 시점 값으로 치환한다.
 * 그래서 「Vercel 에 값을 넣었는데 화면은 여전히 옛 값으로 동작한다」는 상황을
 * 구분할 수 없다 — 코드가 보는 값이 빌드 당시 값이기 때문이다.
 *
 * 동적 인덱싱은 정적 치환의 대상이 아니라 실제 process.env 를 읽는다. 진단은 두
 * 값을 나란히 보여 주고, 다르면 「재배포 필요」라고 알린다.
 * (서버 전용이다. 브라우저에서는 process.env 가 치환된 객체라 아무것도 못 읽는다.)
 */
export function runtimeEnvValue(name: string): string | undefined {
  const env = process.env as Record<string, string | undefined>;
  return env[name];
}

// --- SSO (클라이언트 노출) ------------------------------------------------
//
// NEXT_PUBLIC_ 값은 번들에 인라인되므로 process.env.X 를 통째로 읽으면 안 되고
// 리터럴로 참조해야 한다.

export type SsoMode = "mock" | "real";

export const ssoPublicEnv = {
  mode: (process.env.NEXT_PUBLIC_SSO_MODE === "real" ? "real" : "mock") as SsoMode,
  /**
   * 트레이 모듈의 로컬 WebSocket 주소. 레거시 참고값 `wss://localhost:29283`.
   *
   * **기본값을 두지 않는다.** 그럴듯한 기본값을 박아 두면 환경변수를 빠뜨린 배포가
   * 전 사용자에게 「인증 모듈 미실행」으로 조용히 실패한다. 비어 있으면
   * SSO_CONFIG_MISSING 으로 배포 설정 문제임을 그대로 알린다.
   */
  trayWsUrl: process.env.NEXT_PUBLIC_SSO_TRAY_WS_URL ?? "",
  /**
   * getknoxsso 요청의 data 필드 — 트레이가 애플리케이션을 구분하는 코드다.
   *
   * 레거시 교육포털은 "KCC60TRAY0109" 를 썼다. 그것은 **그 시스템의 코드**이므로
   * 이 서비스용 코드를 따로 발급받아 넣어야 한다. 역시 기본값을 두지 않는다.
   */
  trayAppCode: process.env.NEXT_PUBLIC_SSO_TRAY_APP_CODE ?? "",
};

// --- 모바일 소셜 로그인 (서버 전용) ---------------------------------------
//
// 모바일 앱은 사내 SSO 를 쓸 수 없어(트레이 모듈이 PC 전용) Google · Apple
// 네이티브 로그인으로 받은 ID 토큰을 서버가 검증한다. docs/MOBILE_OAUTH2.md 참고.

export const socialAuthEnv = {
  /**
   * Google ID 토큰의 aud 로 허용할 클라이언트 ID.
   *
   * 앱이 serverClientId 를 넘기므로 Android·iOS 모두 웹 클라이언트 ID 가 aud 로
   * 찍힌다. 설정이 어긋난 빌드가 섞여 들어올 수 있어 플랫폼 ID 도 함께 허용해
   * 두었다. 운영이 안정되면 웹 하나만 남기는 것이 더 안전하다.
   */
  get googleAudiences(): string[] {
    return [
      optionalEnv("GOOGLE_WEB_CLIENT_ID"),
      optionalEnv("GOOGLE_IOS_CLIENT_ID"),
      optionalEnv("GOOGLE_ANDROID_CLIENT_ID"),
    ]
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  },

  /**
   * 허용할 Google Workspace 도메인(`hd` 클레임). **비우면 제한하지 않는다.**
   *
   * hd 는 Google 이 서명한 토큰 안에 들어 있어 이메일 접미사 검사보다 강하다
   * (개인 Gmail 은 hd 를 위조할 수 없다). Apple 에는 대응하는 클레임이 없어
   * 여기서 잠가도 Apple 경로는 열려 있다 — docs/MOBILE_OAUTH2.md 의 「나중에 잠글 때」.
   */
  get allowedGoogleDomains(): string[] {
    return csvEnv("ALLOWED_HOSTED_DOMAINS").map((d) => d.toLowerCase());
  },

  /**
   * Apple ID 토큰의 aud 로 허용할 값. 두 종류가 들어간다.
   *   iOS 네이티브 흐름 — 번들 ID
   *   Android 웹 흐름   — Services ID
   * Google 과 달리 「서버용 클라이언트 ID」 개념이 없어 플랫폼마다 aud 가 다르다.
   */
  get appleAudiences(): string[] {
    return csvEnv("APPLE_CLIENT_IDS");
  },

  /** Apple 콜백이 되돌릴 앱. Android 의 applicationId 와 같아야 한다. */
  get appleAndroidPackage(): string {
    return optionalEnv("APPLE_ANDROID_PACKAGE", "io.github.swpark3179.ainewsletter");
  },
};

// --- 목업 전용 편의 경로 --------------------------------------------------

/**
 * 목업 전용 우회 경로(게스트 열람 · 사번 폴백 · 무로그인 자동 세션)를 열어 둘지.
 *
 * 최종 방침은 「사내 SSO 를 통과하지 못하면 일반 사용을 제공하지 않는다」다.
 * 그래서 이 경로들은 개발용 목업 모드에서만 살아 있다.
 *
 * **운영 빌드는 모드와 무관하게 먼저 막는다.** NEXT_PUBLIC_SSO_MODE 의 기본값이
 * mock 이고 docs/VERCEL_DEPLOY.md 도 첫 배포를 mock 으로 안내하기 때문에, 모드만
 * 보고 판단하면 환경변수 하나를 빠뜨린 운영 배포에서 인증이 사라진다.
 *
 * 두 값 모두 리터럴로 읽는다 — proxy.ts(Edge 런타임)에서도 이 값을 보고,
 * 동적 process.env[name] 은 Edge 번들에 인라인되지 않는다.
 */
export const devAuthEnv = {
  get mockShortcuts(): boolean {
    if (process.env.NODE_ENV === "production") return false;
    return ssoPublicEnv.mode === "mock";
  },
};

// --- LLM (서버/스크립트 전용) --------------------------------------------

/**
 * 어느 LLM 으로 트렌드 브리핑을 쓸지 정한다.
 *
 * LLM_PROVIDER 를 지정하면 그 값을 따르고, 비어 있으면 키가 등록된 쪽을 쓴다.
 * (정기 실행은 워크플로가 LLM_PROVIDER=openai 를 명시한다. 관리자 화면의 수동
 *  실행처럼 값이 없는 경로에서 키 없는 제공자를 골라 실패하는 것을 막는다.)
 */
export function resolveLlmProvider(): "gemini" | "openai" {
  const raw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  if (raw === "openai" || raw === "gemini") return raw;
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (process.env.GEMINI_API_KEY?.trim()) return "gemini";
  return "openai";
}

export const llmEnv = {
  get provider(): "gemini" | "openai" {
    return resolveLlmProvider();
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
    return optionalEnv("OPENAI_MODEL", "gpt-5.6-luna");
  },
  /**
   * Gemini 무료 티어는 gemini-2.5-flash 기준 10 RPM 이다.
   * 호출 사이에 이 간격을 둬서 429 를 피한다. 유료 OpenAI 는 여유가 커서 짧다.
   */
  get minCallIntervalMs() {
    const raw = Number(process.env.LLM_MIN_CALL_INTERVAL_MS);
    if (Number.isFinite(raw) && raw >= 0) return raw;
    return resolveLlmProvider() === "openai" ? 500 : 7000;
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
  /** 쇼케이스(/show)에서 몇 일 전까지 긁어올지 */
  get showLookbackDays() {
    const n = Number(process.env.SHOW_LOOKBACK_DAYS);
    return Number.isFinite(n) && n > 0 ? n : 3;
  },
  /** /show 는 메인보다 글이 뜸해 기본값이 더 작다 */
  get showMaxPages() {
    const n = Number(process.env.SHOW_MAX_PAGES);
    return Number.isFinite(n) && n > 0 ? n : 5;
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
