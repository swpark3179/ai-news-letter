import { NextResponse } from "next/server";
import { z } from "zod";
import { SsoNotRegisteredError, resolveMemberFromSso } from "@/lib/auth/current-user";
import {
  GUEST_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/session";
import { SsoDecodeError, decodeSsoPayload } from "@/lib/auth/sso/decode";
import { clientIp, hitRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * 페이로드 종류를 태그로 구분한다 (types.ts 의 SsoTrayPayload 와 같은 모양).
 *
 * 하나의 opaque 문자열로 받으면 「지금 모드에 맞는 페이로드인가」를 확인할 수
 * 없다 — 실 모드에 목업 페이로드가 들어오면 임의의 EPID 로 세션이 만들어진다.
 * 실제 거절은 decodeSsoPayload 가 한다.
 */
const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mock"),
    encoded: z.string().min(1).max(8_192),
  }),
  z.object({
    kind: z.literal("knox"),
    userInfo: z.string().min(1).max(8_192),
    privateKey: z.string().min(1).max(8_192),
  }),
]);

/**
 * 브라우저가 트레이 모듈에서 받아 온 페이로드를 넘기면, 서버가 디코딩해 EPID 를
 * 얻고, 등록된 사용자인지 대조한 뒤 세션 쿠키를 발급한다.
 *
 *   디코딩       src/lib/auth/sso/decode.ts → decode-knox.ts
 *   등록 대조     src/lib/auth/current-user.ts 의 resolveMemberFromSso
 */
export async function POST(req: Request) {
  // 사내망 안이라도 무제한 시도를 열어 두지는 않는다. 인스턴스마다 따로 세는
  // best-effort 라 보안 경계는 아니다 — 실제 차단은 등록사용자 대조가 한다.
  if (hitRateLimit(`sso:${clientIp(req)}`, 10, 60_000)) {
    return NextResponse.json(
      { error: "요청이 너무 잦습니다. 잠시 후 다시 시도해 주세요.", code: "SSO_RATE_LIMITED" },
      { status: 429 },
    );
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "잘못된 요청 형식입니다." }, { status: 400 });
  }

  let user;
  try {
    const decoded = await decodeSsoPayload(parsed);
    user = await resolveMemberFromSso(decoded);
  } catch (e) {
    // 등록되지 않았거나 중지된 계정 — 화면이 전용 안내 카드를 띄운다.
    if (e instanceof SsoNotRegisteredError) {
      return NextResponse.json(
        { error: e.message, code: "SSO_NOT_REGISTERED" },
        { status: 403 },
      );
    }

    if (e instanceof SsoDecodeError) {
      // 원인은 서버 로그에 남기되, 운영에서는 밖으로 상세를 흘리지 않는다.
      // 어느 전략이 왜 실패했는지가 그대로 나가면 페이로드 위조의 힌트가 된다.
      console.warn("[sso] 디코딩 실패:", e.message);
      return NextResponse.json(
        {
          error:
            process.env.NODE_ENV === "production"
              ? "사내 인증 정보를 확인하지 못했습니다."
              : e.message,
          code: "SSO_DECODE_FAILED",
        },
        { status: 401 },
      );
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
