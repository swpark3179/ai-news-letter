import { NextResponse, type NextRequest } from "next/server";
import { GUEST_COOKIE, SESSION_COOKIE, verifySession } from "@/lib/auth/session";

/**
 * 1차 접근 제어.
 *
 *   세션도 게스트도 아니면            → /login
 *   게스트인데 /admin 으로 들어오면    → /login
 *   세션은 있지만 관리자가 아니면      → /admin 진입 시 / 로 (실제 판단은 서버 컴포넌트가 재확인)
 *
 * proxy 는 Edge 런타임이라 DB 를 보지 않는다. is_admin 은 JWT 에 담긴
 * 값을 신뢰하되, 실제 쓰기 동작에서는 서버가 members 를 다시 확인한다.
 */

const PUBLIC_PATHS = ["/login"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const session = token ? await verifySession(token) : null;
  const guest = req.cookies.get(GUEST_COOKIE)?.value === "1";

  // 로그인 화면: 이미 인증됐으면 1면으로 되돌린다.
  if (isPublic(pathname)) {
    if (session) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // API — 리다이렉트 대신 JSON 401. 자동 저장 중 세션이 만료되면 POST 가
  // /login 으로 307 되어 HTML 이 돌아오고, 에디터의 res.json() 이 깨지면서
  // 무슨 일이 났는지 알 수 없는 오류만 뜬다. 각 핸들러가 스스로 권한을
  // 확인하므로 여기서는 통과 여부만 정한다.
  if (pathname.startsWith("/api/")) {
    if (!session && !guest) {
      return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    }
    return NextResponse.next();
  }

  // 관리자 영역
  if (pathname.startsWith("/admin")) {
    if (!session) {
      return redirectToLogin(req, pathname + search);
    }
    if (!session.isAdmin) {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  // 일반 영역 — 게스트도 열람 가능
  if (!session && !guest) {
    return redirectToLogin(req, pathname + search);
  }

  return NextResponse.next();
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
     *   api/auth  — 로그인 자체를 처리하는 엔드포인트
     *   _next/*   — 프레임워크 정적 자원
     *   파일 확장자가 있는 정적 파일
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.[\\w]+$).*)",
  ],
};
