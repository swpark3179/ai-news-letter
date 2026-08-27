import "server-only";

import { cookies } from "next/headers";
import { devAuthEnv, ssoServerEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { MEMBERS_EPID_MISSING, isMissingColumnError } from "@/lib/supabase/schema";
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
 * 첫 로그인이면 구독자로 **생성한다**. 유닛원 승격이나 관리자 권한 부여는
 * 관리자가 별도로 지정하는 값이므로 여기서 덮어쓰지 않는다.
 *
 * 사내 SSO 로그인은 이 함수를 직접 쓰지 않는다 — 방침이 「등록된 사용자만
 * 로그인한다」라서 아래 resolveMemberFromSso 를 거친다. 이 함수는 목업 전용
 * 경로(mock-session · signin)와, 자동 가입을 명시적으로 켠 경우에만 쓰인다.
 *
 * epid 가 선택인 이유: 사번 폴백 로그인은 트레이를 거치지 않아 EPID 를 알 수 없다.
 */
export type UpsertInput = Omit<DecodedUser, "epid"> & { epid?: string | null };

export async function upsertMemberFromSso(decoded: UpsertInput): Promise<SessionUser> {
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
    // select("*") 가 돌려준 행에 키가 없으면 그 컬럼이 스키마에 없다는 뜻이다
    // (0012 미적용 배포). 없는 컬럼을 update 에 실으면 PGRST204 로 죽는다.
    const hasEpidColumn = "epid" in existing;
    if (hasEpidColumn && decoded.epid && decoded.epid !== existing.epid) {
      patch.epid = decoded.epid;
    }
    if (decoded.name && decoded.name !== existing.name) patch.name = decoded.name;
    if (decoded.email && decoded.email !== existing.email) patch.email = decoded.email;
    if (decoded.dept && decoded.dept !== existing.dept) patch.dept = decoded.dept;

    if (Object.keys(patch).length > 0) {
      await db.from("members").update(patch).eq("id", existing.id);
    }
    return toSessionUser({ ...existing, ...patch });
  }

  let { data: created, error: insErr } = await insertMember(db, decoded, true);

  // 0012 미적용 배포 — epid 만 빼고 다시 넣는다. 목업 경로까지 스키마 하나
  // 때문에 멈출 이유는 없고, 컬럼이 생긴 뒤에는 첫 SSO 로그인이 백필한다.
  if (isMissingColumnError(insErr, "epid")) {
    console.error(`[members] ${MEMBERS_EPID_MISSING}`);
    ({ data: created, error: insErr } = await insertMember(db, decoded, false));
  }

  if (insErr || !created) {
    throw new Error(`members 생성 실패: ${insErr?.message ?? "unknown"}`);
  }
  return toSessionUser(created);
}

/** [withEpid] 가 false 면 epid 를 아예 싣지 않는다 (0012 미적용 배포). */
function insertMember(
  db: ReturnType<typeof supabaseAdmin>,
  decoded: UpsertInput,
  withEpid: boolean,
) {
  return db
    .from("members")
    .insert({
      emp_no: decoded.empNo,
      // 사번 폴백 로그인(목업)은 EPID 를 모른다. 없는 값을 지어내 채우면 그
      // 가짜 EPID 가 members_epid_key 를 선점해, 나중에 진짜 EPID 로 들어오는
      // 사람을 막는다. 모를 때는 null 로 둔다.
      ...(withEpid ? { epid: decoded.epid ?? null } : {}),
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

/** 등록되지 않았거나 사용이 중지된 계정. 라우트가 403 으로 바꾼다. */
export class SsoNotRegisteredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsoNotRegisteredError";
  }
}

/**
 * 배포된 DB 에 코드가 기대하는 컬럼이 없다. 라우트가 503 으로 바꾼다.
 *
 * SsoNotRegisteredError 와 반드시 갈라야 한다 — 둘을 묶으면 「관리자에게 등록을
 * 요청하세요」가 뜨고, 정작 할 일인 마이그레이션 적용은 아무도 하지 않는다.
 * 사용자가 고칠 수 없는 배포 쪽 문제라는 점에서 SSO_CONFIG_MISSING 과 같은 부류다.
 */
export class SsoSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsoSchemaError";
  }
}

/**
 * 디코딩된 SSO 사용자를 **등록된 members 행에 맞춘다.**
 *
 * 방침은 「등록된 사용자만 로그인한다」이므로 기본은 자동 가입하지 않는다.
 * SSO_ALLOW_AUTO_CREATE=true 로 켜면 예전 동작(첫 로그인에 구독자 생성)이 살아난다.
 *
 * 찾는 순서
 *   1) epid    — 트레이가 주는 진짜 식별자. 사번이 바뀌어도 따라온다.
 *   2) emp_no  — EPID 컬럼을 아직 못 채운 계정(시드 5명 포함)을 흡수하는 폴백.
 *                찾으면 그 행에 EPID 를 채워 둔다. 0012 마이그레이션에서 SQL
 *                백필을 뺀 자리를 이 백필이 대신한다 — EPID 는 사번과 다른
 *                체계라 SQL 로 미리 채우면 틀린 값이 유니크 인덱스를 선점한다.
 */
export async function resolveMemberFromSso(decoded: DecodedUser): Promise<SessionUser> {
  const db = supabaseAdmin();

  const byEpid = await findMemberBy(db, "epid", decoded.epid);
  // 0012 미적용 배포. 이 사실은 아래에서 세 번 쓰인다 — 사번으로만 대조하고,
  // 백필을 건너뛰고, 못 찾았을 때 「미등록」이 아니라 「스키마」라고 말한다.
  const epidColumnMissing = byEpid.columnMissing;
  if (epidColumnMissing) console.error(`[sso] ${MEMBERS_EPID_MISSING}`);

  let row = byEpid.row;
  if (!row) {
    const byEmpNo = await findMemberBy(db, "emp_no", decoded.empNo);
    // emp_no 까지 없으면 members 자체가 코드와 어긋난 것이다. 폴백이 없다.
    if (byEmpNo.columnMissing) {
      throw new SsoSchemaError(
        "members.emp_no 컬럼이 없습니다 — supabase/ALL_MIGRATIONS.sql 을 SQL Editor 에서 실행하세요.",
      );
    }
    row = byEmpNo.row;
  }

  if (!row) {
    // EPID 로 찾아본 적이 없으므로 「등록되지 않았다」고 단정할 수 없다.
    // 여기서 미등록이라고 말하면 사용자는 등록을 요청하러 가고, 진짜 원인인
    // 마이그레이션은 그대로 남는다.
    if (epidColumnMissing) throw new SsoSchemaError(MEMBERS_EPID_MISSING);

    if (!ssoServerEnv.autoCreateMembers) {
      throw new SsoNotRegisteredError(
        `등록되지 않은 사용자입니다 (EPID ${maskId(decoded.epid)}). 관리자에게 등록을 요청해 주세요.`,
      );
    }
    return upsertMemberFromSso(decoded);
  }

  // 비활성은 「없음」과 같은 문구로 묶지 않는다 — 사용자가 할 일이 다르다.
  if (!row.is_active) {
    throw new SsoNotRegisteredError("사용이 중지된 계정입니다. 관리자에게 문의해 주세요.");
  }

  const patch: Partial<MemberRow> = {};
  // 최초 SSO 로그인 백필. 컬럼이 없는 배포에서는 건너뛴다 — 백필하겠다고
  // 로그인 자체를 막을 값이 아니다. 컬럼이 생기면 다음 로그인이 채운다.
  if (!epidColumnMissing && !row.epid && decoded.epid) patch.epid = decoded.epid;
  if (decoded.name && decoded.name !== row.name) patch.name = decoded.name;
  if (decoded.email && decoded.email !== row.email) patch.email = decoded.email;
  if (decoded.dept && decoded.dept !== row.dept) patch.dept = decoded.dept;
  // role · is_admin 은 운영자가 관리하는 값이라 SSO 가 덮어쓰지 않는다.

  if (Object.keys(patch).length > 0) {
    const { error } = await db.from("members").update(patch).eq("id", row.id);
    if (error) {
      // 23505 = 다른 행이 이미 그 EPID 를 갖고 있다 (members_epid_key).
      // 백필만 포기하고 로그인은 통과시킨다 — 데이터 정리는 관리자 몫이고,
      // 여기서 막으면 이미 등록된 사람이 남의 데이터 문제로 못 들어온다.
      if (error.code !== "23505") throw new Error(`members 갱신 실패: ${error.message}`);

      console.warn("[sso] EPID 백필 충돌 — 건너뜀", { memberId: row.id });
      delete patch.epid;
      if (Object.keys(patch).length > 0) {
        const retry = await db.from("members").update(patch).eq("id", row.id);
        if (retry.error) throw new Error(`members 갱신 실패: ${retry.error.message}`);
      }
    }
  }

  return toSessionUser({ ...row, ...patch });
}

/**
 * members 조회 결과.
 *
 * 「그 값을 가진 행이 없다」와 「그 컬럼이 스키마에 없다」를 가른다. 둘 다 row 는
 * null 이지만 해야 할 일이 정반대다 — 앞은 사용자 등록, 뒤는 마이그레이션 적용.
 */
interface MemberLookup {
  row: MemberRow | null;
  columnMissing: boolean;
}

async function findMemberBy(
  db: ReturnType<typeof supabaseAdmin>,
  col: "epid" | "emp_no",
  value: string,
): Promise<MemberLookup> {
  if (!value) return { row: null, columnMissing: false };
  const { data, error } = await db
    .from("members")
    .select("*")
    .eq(col, value)
    .maybeSingle<MemberRow>();
  if (error) {
    if (isMissingColumnError(error, col)) return { row: null, columnMissing: true };
    throw new Error(`members 조회 실패: ${error.message}`);
  }
  return { row: data ?? null, columnMissing: false };
}

/** 로그·에러 문구에 식별자를 통째로 남기지 않는다. */
function maskId(v: string): string {
  return v.length <= 4 ? "****" : `${v.slice(0, 2)}****${v.slice(-2)}`;
}
