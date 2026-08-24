import "server-only";

import { cookies } from "next/headers";
import { devAuthEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { DecodedUser } from "@/lib/auth/sso/types";
import type { MemberRow } from "@/types/db";
import {
  GUEST_COOKIE,
  SESSION_COOKIE,
  getBearerUser,
  pickSessionUser,
  verifySession,
  type SessionUser,
} from "./session";

/**
 * 서버 컴포넌트 / 라우트 핸들러에서 현재 로그인 상태를 읽는다.
 * proxy 가 이미 1차 검증을 하지만, 실제 권한 판단은 항상 여기서 한다.
 *
 * 자격증명이 들어오는 길은 두 개다.
 *   웹  — HttpOnly 쿠키 `ainl_session`
 *   앱  — `Authorization: Bearer <accessToken>` (같은 서명의 JWT)
 *
 * [req] 를 넘기면 헤더를 먼저 본다. **API 라우트는 반드시 넘길 것** — 넘기지
 * 않으면 웹은 그대로 동작하고 앱만 401 이 되어 조용히 어긋난다.
 * 서버 컴포넌트에는 Request 가 없으므로 인자 없이 호출한다.
 */

export async function getSessionUser(req?: Request): Promise<SessionUser | null> {
  // 헤더를 먼저 보는 것이 안전하다 — 브라우저는 Authorization 을 스스로 붙이지
  // 않으므로, 남이 쿠키 세션을 헤더로 덮어쓸 길이 없다.
  if (req) {
    const bearer = await getBearerUser(req);
    if (bearer) return bearer;
  }

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  return pickSessionUser(payload);
}

/**
 * 게스트(로그인 없이 둘러보기) 여부.
 *
 * 최종 방침은 「사내 SSO 를 통과하지 못하면 일반 사용을 제공하지 않는다」이므로
 * 게스트 열람은 목업 모드에서만 살아 있다. 이 한 줄이 게이트라서
 * getViewer().guest·canView·Header 의 게스트 배너가 전부 따라 닫힌다.
 */
export async function isGuest(): Promise<boolean> {
  if (!devAuthEnv.mockShortcuts) return false;
  const jar = await cookies();
  return jar.get(GUEST_COOKIE)?.value === "1";
}

export interface ViewerContext {
  user: SessionUser | null;
  guest: boolean;
  /** 로그인했거나 게스트로 들어온 상태 — 화면을 보여줘도 되는지 */
  canView: boolean;
  /** 스크랩·코멘트 등 쓰기 동작 가능 여부 */
  canInteract: boolean;
}

export async function getViewer(req?: Request): Promise<ViewerContext> {
  const [user, guest] = await Promise.all([getSessionUser(req), isGuest()]);
  return {
    user,
    guest: !user && guest,
    canView: !!user || guest,
    canInteract: !!user,
  };
}

/**
 * SSO/사번 로그인으로 확인된 사용자를 members 에 반영하고 세션용 형태로 돌려준다.
 *
 * 첫 로그인이면 구독자로 생성한다. 유닛원 승격이나 관리자 권한 부여는
 * 관리자가 별도로 지정하는 값이므로 여기서 덮어쓰지 않는다.
 */
export async function upsertMemberFromSso(decoded: DecodedUser): Promise<SessionUser> {
  const db = supabaseAdmin();

  const { data: existing, error: selErr } = await db
    .from("members")
    .select("*")
    .eq("emp_no", decoded.empNo)
    .maybeSingle<MemberRow>();

  if (selErr) throw new Error(`members 조회 실패: ${selErr.message}`);

  if (existing) {
    // 이름/부서만 최신값으로 갱신. role·is_admin 은 운영자가 관리하는 값이라 건드리지 않는다.
    const patch: Partial<MemberRow> = {};
    if (decoded.name && decoded.name !== existing.name) patch.name = decoded.name;
    if (decoded.email && decoded.email !== existing.email) patch.email = decoded.email;
    if (decoded.dept && decoded.dept !== existing.dept) patch.dept = decoded.dept;

    if (Object.keys(patch).length > 0) {
      await db.from("members").update(patch).eq("id", existing.id);
    }
    return toSessionUser({ ...existing, ...patch });
  }

  const { data: created, error: insErr } = await db
    .from("members")
    .insert({
      emp_no: decoded.empNo,
      name: decoded.name,
      email: decoded.email ?? null,
      dept: decoded.dept ?? null,
      role: "subscriber",
      is_admin: false,
      initial: decoded.name.slice(-2),
      avatar_tone: "gray",
    })
    .select("*")
    .single<MemberRow>();

  if (insErr || !created) {
    throw new Error(`members 생성 실패: ${insErr?.message ?? "unknown"}`);
  }
  return toSessionUser(created);
}

export function toSessionUser(m: MemberRow): SessionUser {
  return {
    id: m.id,
    empNo: m.emp_no,
    name: m.name,
    role: m.role,
    isAdmin: m.is_admin,
    initial: m.initial,
    avatarTone: m.avatar_tone,
  };
}
