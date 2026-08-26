import { NextResponse, type NextRequest } from "next/server";
import { devAuthEnv } from "@/lib/env";
import {
  GUEST_COOKIE,
  SESSION_COOKIE,
  getBearerUser,
  verifySession,
} from "@/lib/auth/session";

/**
 * 1차 접근 제어.
 *
 *   세션도 게스트도 아니면            → /login
 *   게스트인데 /admin 으로 들어오면    → /login
 *   세션은 있지만 관리자가 아니면      → /admin 진입 시 / 로 (실제 판단은 서버 컴포넌트가 재확인)
 *
 * proxy 는 Edge 런타임이라 DB 를 보지 않는다. is_admin 은 JWT 에 담긴
 * 값을 신뢰하되, 실제 쓰기 동작에서는 서버가 members 를 다시 확인한다.
 *
 * 자격증명이 들어오는 길은 두 개다.
 *   웹  — HttpOnly 쿠키 `ainl_session`
 *   앱  — `Authorization: Bearer <accessToken>` (같은 서명의 JWT)
 * 헤더는 /api/* 에서만 본다. 화면 경로는 쿠키만 보므로 새 자격증명 경로가
 * JSON 엔드포인트 밖으로 번지지 않는다.
 */

const PUBLIC_PATHS = ["/login"];

/** 목업 세션을 발급하는 라우트. api/auth 라서 아래 matcher 밖이다. */
const MOCK_SESSION_PATH = "/api/auth/mock-session";

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(req: NextRequest) {
  const { pathname, search, searchParams } = req.nextUrl;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;

  // 게스트 열람은 목업 모드에서만 살아 있다. 최종 방침은 「사내 SSO 를 통과하지
  // 못하면 일반 사용을 제공하지 않는다」다 (current-user.ts 의 isGuest 참고).
  const guest =
    devAuthEnv.mockShortcuts && req.cookies.get(GUEST_COOKIE)?.value === "1";

  // 로그인 화면: 이미 인증됐으면 1면으로 되돌린다.
  // 단 ?fail= · ?force= 가 붙어 있으면 그대로 보여 준다 — 목업 자동 세션이
  // 생긴 뒤에도 실패 화면을 확인할 수 있어야 한다.
  //
  // 되돌리는 것은 **로그인 화면 자체뿐**이다. /login/diag 는 세션이 있는 채로
  // 봐야 하는 진단 화면이다 — 「로그인은 됐는데 그다음이 문제인가」를 가리는
  // 절차가 곧 「로그인한 뒤 진단을 다시 실행한다」이기 때문이다 (docs/SSO_DEBUG.md).
  if (isPublic(pathname)) {
    const isLoginScreen = pathname === "/login";
    const inspecting = searchParams.has("fail") || searchParams.has("force");
    if (session && isLoginScreen && !inspecting) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // API — 리다이렉트 대신 JSON 401. 자동 저장 중 세션이 만료되면 POST 가
  // /login 으로 307 되어 HTML 이 돌아오고, 에디터의 res.json() 이 깨지면서
  // 무슨 일이 났는지 알 수 없는 오류만 뜬다. 각 핸들러가 스스로 권한을
  // 확인하므로 여기서는 통과 여부만 정한다.
  if (pathname.startsWith("/api/")) {
    // 앱은 쿠키를 쓰지 않는다. 여기서 헤더를 함께 보지 않으면 /api/me 와
    // /api/scraps 가 핸들러에 닿기 전에 401 이 된다.
    // (로그인 엔드포인트들은 api/auth 라서 matcher 밖이다.)
    const authorized = session ?? (await getBearerUser(req));
    if (!authorized && !guest) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    return NextResponse.next();
  }

  // 관리자 영역
  if (pathname.startsWith("/admin")) {
    if (!session) {
      return needsLogin(req, pathname + search);
    }
    if (!session.isAdmin) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // 일반 영역 — 게스트도 열람 가능 (목업 모드에 한해)
  if (!session && !guest) {
    return needsLogin(req, pathname + search);
  }

  return NextResponse.next();
}

/**
 * 세션이 없는 화면 요청을 어디로 보낼지.
 *
 * 목업 모드에서는 로그인 화면을 거치지 않고 목업 사용자로 세션을 만든다 —
 * 개발 중에 매번 로그인 연극을 볼 이유가 없다. 실 모드와 운영 빌드에서는
 * devAuthEnv 가 false 라 언제나 /login 으로 간다.
 */
function needsLogin(req: NextRequest, next: string) {
  if (devAuthEnv.mockShortcuts && req.method === "GET") {
    const url = new URL(MOCK_SESSION_PATH, req.url);
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }
  return redirectToLogin(req, next);
}

function redirectToLogin(req: NextRequest, next: string) {
  const url = new URL("/login", req.url);
  if (next && next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * 아래를 제외한 모든 경로에 적용:
     *   api/auth  — 로그인 자체를 처리하는 엔드포인트 (목업 세션 발급 포함)
     *   _next/*   — 프레임워크 정적 자원
     *   파일 확장자가 있는 정적 파일
     *
     * /api/me 와 나머지 /api/* 는 일부러 여기에 남긴다 — 위의 Bearer 분기가
     * 유효한 토큰만 통과시키고, 그 밖의 것은 핸들러에 닿기 전에 401 이 된다.
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)",
  ],
};
