import "server-only";

import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { DecodedUser } from "@/lib/auth/sso/types";
import type { MemberRow } from "@/types/db";
import {
  GUEST_COOKIE,
  SESSION_COOKIE,
  verifySession,
  type SessionUser,
} from "./session";

/**
 * 서버 컴포넌트 / 라우트 핸들러에서 현재 로그인 상태를 읽는다.
 * middleware 가 이미 1차 검증을 하지만, 실제 권한 판단은 항상 여기서 한다.
 */

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySession(token);
  if (!payload) return null;
  const { id, empNo, name, role, isAdmin, initial, avatarTone } = payload;
  return { id, empNo, name, role, isAdmin, initial, avatarTone };
}

export async function isGuest(): Promise<boolean> {
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

export async function getViewer(): Promise<ViewerContext> {
  const [user, guest] = await Promise.all([getSessionUser(), isGuest()]);
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
