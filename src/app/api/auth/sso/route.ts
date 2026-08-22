import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertMemberFromSso } from "@/lib/auth/current-user";
import {
  GUEST_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/session";
import { SsoDecodeError, decodeSsoPayload } from "@/lib/auth/sso/decode";

export const runtime = "nodejs";

const bodySchema = z.object({
  encoded: z.string().min(1).max(16_384),
});

/**
 * 브라우저가 트레이 모듈에서 받아 온 인코딩 페이로드를 넘기면,
 * 서버가 디코딩해 사용자 정보를 얻고 세션 쿠키를 발급한다.
 *
 * 실제 복호화·서명검증은 src/lib/auth/sso/decode.ts 안에 있다.
 */
export async function POST(req: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  let user;
  try {
    const decoded = await decodeSsoPayload(parsed.encoded);
    user = await upsertMemberFromSso(decoded);
  } catch (e) {
    if (e instanceof SsoDecodeError) {
      return NextResponse.json({ error: e.message }, { status: 401 });
    }
    const msg = e instanceof Error ? e.message : "인증 처리 중 오류가 발생했습니다.";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const token = await signSession(user);
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  res.cookies.delete(GUEST_COOKIE);
  return res;
}
