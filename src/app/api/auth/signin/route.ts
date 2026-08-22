import { NextResponse } from "next/server";
import { z } from "zod";
import { ssoPublicEnv } from "@/lib/env";
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
 * ★ 실구현 자리 — 사번 + 비밀번호 폴백 로그인
 * ===========================================================================
 *
 * SSO 자동 로그인이 불가능한 상황(트레이 모듈 미설치, 사외 기기)의 대체 경로.
 * 현재는 목업이라 비밀번호를 검증하지 않고 사번만 확인한다.
 *
 * 실구현 시 해야 할 일
 *   - 사내 LDAP / 인증 API 에 (사번, 비밀번호)를 위임 검증
 *   - 실패 횟수 제한 (같은 사번·IP 기준 레이트리밋)
 *   - 성공 시에만 아래 세션 발급 로직으로 진행
 *
 * 비밀번호를 이 서비스의 DB 에 저장하지 않는다는 원칙은 유지할 것.
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

  if (ssoPublicEnv.mode === "real") {
    // TODO(사내연동): 사내 인증 API 로 (empNo, password) 검증 후 아래로 진행
    return NextResponse.json(
      {
        error:
          "사번 로그인이 아직 구현되지 않았습니다. src/app/api/auth/signin/route.ts 를 채우세요.",
      },
      { status: 501 },
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
