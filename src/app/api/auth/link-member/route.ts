import { NextResponse } from "next/server";
import { z } from "zod";
import { getBearerUser } from "@/lib/auth/session";
import { issueMobileSession } from "@/lib/auth/mobile-session";
import {
  claimMemberByEmpNo,
  identityEmails,
  lastUsedProvider,
  SocialAuthError,
  userPayload,
} from "@/lib/auth/social-identity";

export const runtime = "nodejs";

/**
 * 사번으로 웹의 기존 계정에 이어 붙인다.
 *
 * **로그인 수단이 아니다.** 이미 Google 또는 Apple 로 로그인한 사람이, 자동
 * 가입으로 만들어진 임시 계정을 원래 쓰던 사번 계정으로 바꾸는 경로다.
 *
 * members.email 이 비어 있어 이메일 자동 매칭이 실패한 사용자를 위한 것이므로,
 * 그 필드를 백필하면 이 경로를 타는 사람은 거의 없어진다
 * (supabase/migrations/0010_google_identities.sql 아래쪽 참고).
 *
 * 사번의 소유를 증명하지 않는 경로라는 점과 그래서 관리자 계정을 대상에서
 * 뺀 이유는 claimMemberByEmpNo 주석에 적어 두었다.
 *
 * Apple 「이메일 가리기」로 들어온 사용자는 백필과 무관하게 이 경로가 필요하다 —
 * 릴레이 주소는 members.email 과 절대 맞지 않는다.
 */

const bodySchema = z.object({ empNo: z.string().trim().min(4).max(32) });

export async function POST(req: Request) {
  const user = await getBearerUser(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "사번을 확인해 주세요." }, { status: 400 });
  }

  try {
    const linked = await claimMemberByEmpNo(user.id, parsed.empNo);
    // members.id 가 바뀌었으므로 세션을 새로 발급한다.
    const session = await issueMobileSession(linked);
    return NextResponse.json({
      accessToken: session.accessToken,
      refreshToken: session.refreshToken,
      expiresIn: session.expiresIn,
      user: userPayload({
        user: linked,
        // 매핑이 새 멤버로 옮겨졌으므로 옮긴 쪽에서 다시 읽는다.
        emails: await identityEmails(linked.id),
        provider: await lastUsedProvider(linked.id),
        linkedToExistingMember: true,
      }),
    });
  } catch (e) {
    if (e instanceof SocialAuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: "연결하지 못했습니다." }, { status: 500 });
  }
}
