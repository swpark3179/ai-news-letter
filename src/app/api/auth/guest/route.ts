import { NextResponse } from "next/server";
import { GUEST_COOKIE, sessionCookieOptions } from "@/lib/auth/session";

export const runtime = "nodejs";

/**
 * 로그인 없이 둘러보기.
 * 공개 기사만 열람되고 스크랩·코멘트는 막힌다 (디자인의 노란 배너 상태).
 */
export async function POST() {
  const res = NextResponse.json({ guest: true });
  res.cookies.set(GUEST_COOKIE, "1", sessionCookieOptions(60 * 60 * 2));
  return res;
}
