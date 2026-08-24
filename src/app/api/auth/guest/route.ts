import { NextResponse } from "next/server";
import { devAuthEnv } from "@/lib/env";
import { GUEST_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * 로그인 없이 둘러보기 — **목업 모드 전용**.
 *
 * 최종 방침은 「사내 SSO 를 통과하지 못하면 일반 사용을 제공하지 않는다」다.
 * 그래서 실 모드와 운영 빌드에서는 이 경로가 닫힌다 (devAuthEnv 참고).
 * 목업 모드에서는 공개 기사만 열람되고 스크랩·코멘트는 막힌다.
 */
export async function POST() {
  if (!devAuthEnv.mockShortcuts) {
    return NextResponse.json(
      { error: "사내 인증을 통과한 계정만 이용할 수 있습니다." },
      { status: 403 },
    );
  }

  const res = NextResponse.json({ guest: true });
  res.cookies.set(GUEST_COOKIE, "1", sessionCookieOptions(60 * 60 * 2));
  return res;
}
