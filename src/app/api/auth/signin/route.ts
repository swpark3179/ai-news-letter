import { NextResponse } from "next/server";
import { z } from "zod";
import { devAuthEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { toSessionUser, upsertMemberFromSso } from "@/lib/auth/current-user";
import {
  GUEST_COOKIE,
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/session";
import type { MemberRow } from "@/types/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  empNo: z.string().trim().min(4).max(32),
  password: z.string().min(1).max(256),
});

/* ===========================================================================
 * 사번 + 비밀번호 폴백 로그인 — **목업 모드 전용**
 * ===========================================================================
 *
 * 최종 방침은 「사내 SSO 를 통과하지 못하면 일반 사용을 제공하지 않는다」다.
 * 그래서 이 경로는 실 모드와 운영 빌드에서 닫혀 있고, 목업 모드에서만
 * 로그인 화면의 폴백으로 살아 있다 (비밀번호를 검증하지 않는다).
 *
 * 모드만 보고 판단하지 않는 이유: NEXT_PUBLIC_SSO_MODE 의 기본값이 mock 이라
 * 환경변수 하나를 빠뜨린 운영 배포에서 「아무 사번 + 아무 비밀번호」가 통과하게
 * 된다. 시드의 사번 21084213 은 is_admin 이다 (devAuthEnv 주석 참고).
 *
 * 방침이 바뀌어 사내 인증 API 를 붙이기로 하면 여기를 채운다.
 *   - 사내 LDAP / 인증 API 에 (사번, 비밀번호)를 위임 검증
 *   - 실패 횟수 제한 (같은 사번·IP 기준 레이트리밋)
 *   - 성공 시에만 아래 세션 발급 로직으로 진행
 * 그때도 비밀번호를 이 서비스의 DB 에 저장하지 않는다는 원칙은 유지할 것.
 *
 * SSO 를 쓸 수 없는 모바일은 이 경로가 아니라 OAuth2 로 들어온다 —
 * docs/MOBILE_OAUTH2.md.
 * ------------------------------------------------------------------------ */

export async function POST(req: Request) {
  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "사번과 비밀번호를 입력해 주세요." },
      { status: 400 },
    );
  }

  if (!devAuthEnv.mockShortcuts) {
    return NextResponse.json(
      { error: "사내 인증을 통과한 계정만 이용할 수 있습니다." },
      { status: 403 },
    );
  }

  // --- 목업 경로 ---------------------------------------------------------
  // 비밀번호는 검증하지 않는다. 이미 등록된 사번이면 그 사용자로,
  // 처음 보는 사번이면 구독자로 새로 만든다.
  const db = supabaseAdmin();
  const { data: existing } = await db
    .from("members")
    .select("*")
    .eq("emp_no", parsed.empNo)
    .maybeSingle<MemberRow>();

  const user = existing
    ? toSessionUser(existing)
    : await upsertMemberFromSso({
        empNo: parsed.empNo,
        name: `사번 ${parsed.empNo}`,
        email: null,
        dept: null,
      });

  const token = await signSession(user);
  const res = NextResponse.json({ user });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions());
  res.cookies.delete(GUEST_COOKIE);
  return res;
}
