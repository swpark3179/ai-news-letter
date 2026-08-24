import { NextResponse } from "next/server";
import { z } from "zod";
import { getBearerUser } from "@/lib/auth/session";
import { revokeAllForMember, revokeRefreshToken } from "@/lib/auth/mobile-session";

export const runtime = "nodejs";

/**
 * 모바일 로그아웃.
 *
 * refreshToken 을 주면 그 기기만, 안 주면 그 계정의 모든 기기를 끊는다.
 * 앱은 이 호출이 실패해도 로컬 토큰을 지우고 로그아웃한다.
 */

const bodySchema = z.object({ refreshToken: z.string().max(512).optional() });

export async function POST(req: Request) {
  const user = await getBearerUser(req);
  if (!user) return NextResponse.json({ ok: true });

  let body: { refreshToken?: string } = {};
  try {
    body = bodySchema.parse(await req.json().catch(() => ({})));
  } catch {
    body = {};
  }

  if (body.refreshToken) {
    await revokeRefreshToken(body.refreshToken);
  } else {
    await revokeAllForMember(user.id);
  }
  return NextResponse.json({ ok: true });
}
