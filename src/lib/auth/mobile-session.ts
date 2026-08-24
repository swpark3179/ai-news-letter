import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { sessionEnv } from "@/lib/env";
import { toSessionUser } from "@/lib/auth/current-user";
import { signSession, type SessionUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { MemberRefreshTokenRow, MemberRow } from "@/types/db";

/**
 * 모바일 세션.
 *
 * 웹은 HttpOnly 쿠키 `ainl_session` 에 8시간짜리 JWT 를 담는다. 앱에서 8시간마다
 * 다시 로그인하게 할 수는 없으므로 둘로 나눈다:
 *
 *   액세스 토큰  — 웹과 **같은 서명·같은 페이로드**의 JWT. 헤더로 보낸다.
 *                  형식이 같아서 getSessionUser() 를 거의 그대로 재사용한다.
 *   리프레시 토큰 — 임의의 256비트 문자열. DB 에는 sha256 해시만 남긴다.
 *
 * 리프레시는 **회전(rotation)** 한다 — 쓰면 폐기하고 새로 발급한다.
 * 같은 리프레시 토큰이 두 번 오면 탈취를 의심하고 그 기기의 세션을 모두 끊는다.
 *
 * `Authorization` 헤더에서 사용자를 꺼내는 getBearerUser 는 여기가 아니라
 * session.ts 에 있다 — proxy.ts(Edge)도 그 함수를 쓰는데, 이 파일은
 * node:crypto 와 supabaseAdmin 을 끌어와 Edge 번들에 들어갈 수 없다.
 */

export interface MobileSession {
  accessToken: string;
  refreshToken: string;
  /** 액세스 토큰 만료까지 남은 초. 앱이 선제 갱신에 쓴다. */
  expiresIn: number;
}

export async function issueMobileSession(
  user: SessionUser,
  deviceLabel?: string,
): Promise<MobileSession> {
  const accessToken = await signSession(user);
  const refreshToken = randomBytes(32).toString("base64url");

  const expiresAt = new Date(
    Date.now() + sessionEnv.refreshTtlDays * 24 * 60 * 60 * 1000,
  );
  const { error } = await supabaseAdmin().from("member_refresh_tokens").insert({
    member_id: user.id,
    token_hash: hash(refreshToken),
    device_label: deviceLabel ?? null,
    expires_at: expiresAt.toISOString(),
  });
  if (error) throw new Error(`세션을 만들지 못했습니다: ${error.message}`);

  // 액세스 토큰 수명은 웹 세션 쿠키와 같은 값이다. 두 곳에 따로 쓰면 앱의
  // 선제 갱신 시점이 실제 만료와 어긋난다.
  return { accessToken, refreshToken, expiresIn: sessionEnv.maxAgeSec };
}

export class RefreshError extends Error {}

/** 리프레시 토큰을 회전시키며 새 세션을 낸다. */
export async function rotateMobileSession(refreshToken: string): Promise<MobileSession> {
  const db = supabaseAdmin();
  const tokenHash = hash(refreshToken);

  const { data: row } = await db
    .from("member_refresh_tokens")
    .select("id, member_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle<
      Pick<MemberRefreshTokenRow, "id" | "member_id" | "expires_at" | "revoked_at">
    >();

  if (!row) throw new RefreshError("세션이 만료되었습니다.");

  if (row.revoked_at) {
    // 이미 쓴 토큰이 다시 왔다 — 탈취 가능성. 이 멤버의 모든 세션을 끊는다.
    await revokeAllForMember(row.member_id);
    throw new RefreshError("세션이 만료되었습니다.");
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new RefreshError("세션이 만료되었습니다.");
  }

  const { data: member } = await db
    .from("members")
    .select("*")
    .eq("id", row.member_id)
    .maybeSingle<MemberRow>();

  if (!member || !member.is_active) {
    await revokeAllForMember(row.member_id);
    throw new RefreshError("사용할 수 없는 계정입니다.");
  }

  await db
    .from("member_refresh_tokens")
    .update({ revoked_at: new Date().toISOString(), last_used_at: new Date().toISOString() })
    .eq("id", row.id);

  return issueMobileSession(toSessionUser(member));
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await supabaseAdmin()
    .from("member_refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", hash(refreshToken));
}

export async function revokeAllForMember(memberId: string): Promise<void> {
  await supabaseAdmin()
    .from("member_refresh_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("member_id", memberId)
    .is("revoked_at", null);
}

function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
