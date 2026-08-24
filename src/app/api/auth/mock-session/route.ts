import { NextResponse } from "next/server";
import { devAuthEnv } from "@/lib/env";
import { upsertMemberFromSso } from "@/lib/auth/current-user";
import { MOCK_USER } from "@/lib/auth/sso/mock-user";
import {
  GUEST_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * 목업 모드 — 로그인 화면을 거치지 않고 세션을 만든다.
 *
 * proxy 가 쿠키 없는 GET 을 여기로 보낸다. 왜 proxy 에서 바로 만들지 않는가:
 * SessionUser.id 는 실제 members.id(uuid)여야 하고(scraps·comments·articles 가
 * FK 로 참조한다) proxy 는 Edge 런타임이라 Supabase 를 볼 수 없다. 그래서
 * Node 라우트에 한 번 들렀다 간다.
 *
 * 세션을 만들 때만 DB 를 건드리므로 유효 기간(8시간)에 한 번 돈다.
 * 결과를 캐시하지는 않는다 — 대시보드에서 방금 바꾼 is_admin 을 가려 버린다.
 *
 * 실 SSO 로그인(POST /api/auth/sso)과 같은 upsertMemberFromSso 를 쓰므로
 * 두 경로가 같은 members 행으로 모인다.
 */
export async function GET(req: Request) {
  // 운영 빌드에서는 devAuthEnv 가 항상 false 다. 존재를 알리지 않는다.
  if (!devAuthEnv.mockShortcuts) {
    return new NextResponse(null, { status: 404 });
  }

  const next = safeNext(new URL(req.url).searchParams.get("next"));

  let user;
  try {
    user = await upsertMemberFromSso(MOCK_USER);
  } catch {
    // Supabase 가 없거나 스키마가 없으면 세션을 만들 수 없다. next 로 되돌리면
    // proxy 가 다시 여기로 보내 무한 왕복이 된다. 로그인 화면으로 보내면
    // 목업 SSO 가 같은 실패를 실제 오류 문구와 함께 보여 준다.
    return NextResponse.redirect(new URL("/login", req.url), 303);
  }

  const token = await signSession(user);
  // 303 — 원래 요청 방식과 무관하게 다음 요청을 GET 으로 만든다.
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  res.cookies.delete(GUEST_COOKIE);
  res.headers.set("cache-control", "no-store");
  return res;
}

/** 오픈 리다이렉트 방지 — login/page.tsx 와 같은 규칙. */
function safeNext(raw: string | null): string {
  if (!raw) return "/";
  return raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}
