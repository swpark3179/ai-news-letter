import { SignJWT, jwtVerify } from "jose";
import { sessionEnv } from "@/lib/env";
import type { MemberRole } from "@/types/db";

/**
 * 세션 = jose 로 서명한 JWT 를 HttpOnly 쿠키에 담은 것.
 *
 * Supabase Auth 를 쓰지 않는 이유: 로그인 주체가 사내 SSO 라서 Supabase 쪽에
 * 사용자를 만들 필요가 없고, 만들면 두 곳에서 사용자 상태를 관리하게 된다.
 *
 * 이 파일은 middleware(Edge 런타임)에서도 import 되므로 Node 전용 API 를
 * 쓰지 않는다. jose 는 Web Crypto 기반이라 양쪽에서 동작한다.
 */

export interface SessionUser {
  /** members.id */
  id: string;
  empNo: string;
  name: string;
  role: MemberRole;
  isAdmin: boolean;
  initial: string | null;
  avatarTone: string;
}

export interface SessionPayload extends SessionUser {
  iat: number;
  exp: number;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(sessionEnv.secret);
}

export async function signSession(user: SessionUser): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + sessionEnv.maxAgeSec)
    .setIssuer("ai-newsletter")
    .sign(secretKey());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), {
      issuer: "ai-newsletter",
    });
    if (!payload.id || !payload.empNo) return null;
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

/** Set-Cookie 에 넣을 옵션 (next/headers cookies().set 과 호환) */
export function sessionCookieOptions(maxAge: number = sessionEnv.maxAgeSec) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  };
}

export const SESSION_COOKIE = sessionEnv.cookieName;
export const GUEST_COOKIE = sessionEnv.guestCookieName;
