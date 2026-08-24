import { NextResponse } from "next/server";
import { z } from "zod";
import { linkGoogleIdentity, verifyGoogleIdToken } from "@/lib/auth/google-identity";
import { issueMobileSession } from "@/lib/auth/mobile-session";
import { SocialAuthError, userPayload } from "@/lib/auth/social-identity";

export const runtime = "nodejs";

/**
 * 모바일 Google 로그인.
 *
 * 앱이 Google 에서 받은 ID 토큰을 그대로 보낸다. 서버가 서명을 검증하고
 * members 에 이어 붙인 뒤 모바일 세션(액세스 + 리프레시)을 내준다.
 * `/api/auth/apple` 과 응답 모양이 같다.
 *
 * 쿠키를 굽지 않는다 — 앱은 Authorization 헤더를 쓴다.
 */

const bodySchema = z.object({
  idToken: z.string().min(20).max(4096),
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
    const payload = await verifyGoogleIdToken(parsed.idToken);
    const linked = await linkGoogleIdentity(payload);
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
