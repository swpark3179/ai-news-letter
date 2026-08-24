import { NextResponse } from "next/server";
import { z } from "zod";
import { linkAppleIdentity, verifyAppleIdToken } from "@/lib/auth/apple-identity";
import { issueMobileSession } from "@/lib/auth/mobile-session";
import { SocialAuthError, userPayload } from "@/lib/auth/social-identity";

export const runtime = "nodejs";

/**
 * 모바일 Apple 로그인.
 *
 * 앱이 Apple 에서 받은 ID 토큰을 그대로 보낸다. 서버가 서명을 검증하고
 * members 에 이어 붙인 뒤 모바일 세션(액세스 + 리프레시)을 내준다.
 * `/api/auth/google` 과 응답 모양이 같다.
 *
 * 쿠키를 굽지 않는다 — 앱은 Authorization 헤더를 쓴다.
 */

const bodySchema = z.object({
  idToken: z.string().min(20).max(4096),

  /**
   * 앱이 인증 요청에 실었던 1회용 값의 원문. 토큰의 `nonce` 클레임과 맞춰
   * 재생 공격을 막는다. 구버전 앱과의 호환을 위해 필수는 아니다.
   */
  nonce: z.string().trim().min(8).max(256).optional(),

  /**
   * Apple 이 **최초 인증 때 한 번만** 주는 이름. 앱이 조립해 보낸다.
   * 서명된 값이 아니므로 표시용으로만 쓴다 — 계정을 찾는 데는 쓰지 않는다.
   */
  name: z.string().trim().max(120).optional(),

  // 「iPhone 15 · iOS 26.1」 같은 표시용 라벨. 없어도 된다.
  deviceLabel: z.string().trim().max(120).optional(),
});

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  try {
    const claims = await verifyAppleIdToken(parsed.idToken, parsed.nonce);
    const linked = await linkAppleIdentity(claims, parsed.name);
    const session = await issueMobileSession(linked.user, parsed.deviceLabel);

    return NextResponse.json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: session.expiresIn,
      user: userPayload({
        user: linked.user,
        emails: linked.emails,
        provider: linked.provider,
        linkedToExistingMember: linked.linkedToExistingMember,
      }),
    });
  } catch (e) {
    if (e instanceof SocialAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "로그인에 실패했습니다." }, { status: 500 });
  }
}
