import { NextResponse } from "next/server";
import { getBearerUser } from "@/lib/auth/session";
import {
  identityEmails,
  isGeneratedEmpNo,
  lastUsedProvider,
  userPayload,
} from "@/lib/auth/social-identity";

export const runtime = "nodejs";

/**
 * 앱이 시작할 때 저장된 토큰으로 세션을 되살리며 호출한다.
 *
 * 응답은 `/api/auth/google` · `/api/auth/apple` 의 `user` 객체와 같은 모양이다.
 * 액세스 토큰(JWT)에는 어느 수단으로 들어왔는지가 없어서 —
 * 웹 세션과 같은 페이로드를 유지해야 하므로 — 매핑의 last_login_at 으로
 * 되짚는다 (lastUsedProvider).
 */
export async function GET(req: Request) {
  const user = await getBearerUser(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const [emails, provider] = await Promise.all([
    identityEmails(user.id),
    lastUsedProvider(user.id),
  ]);

  return NextResponse.json(
    userPayload({
      user,
      emails,
      provider,
      linkedToExistingMember: !isGeneratedEmpNo(user.empNo),
    }),
  );
}
