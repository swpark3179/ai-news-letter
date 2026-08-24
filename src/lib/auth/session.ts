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

/** JWT 페이로드에서 세션 필드만 골라낸다 (iat/exp 를 밖으로 흘리지 않는다). */
export function pickSessionUser(p: SessionPayload): SessionUser {
  const { id, empNo, name, role, isAdmin, initial, avatarTone } = p;
  return { id, empNo, name, role, isAdmin, initial, avatarTone };
}

/**
 * `Authorization: Bearer <jwt>` 에서 토큰만 꺼낸다.
 *
 * **헤더에서만 읽는다.** 쿼리스트링이나 폼 필드로도 받으면 브라우저가 스스로
 * 붙이는 자격증명이 되고, CSRF 토큰 없이 sameSite=lax 로 버티는 현재 구조
 * (sessionCookieOptions 참고)가 그 자리에서 무너진다.
 */
export function bearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

/**
 * Bearer 토큰에서 사용자를 꺼낸다 — 모바일 앱은 쿠키를 쓰지 않는다.
 *
 * 앱의 액세스 토큰은 웹 세션 쿠키와 **같은 서명·같은 페이로드**의 JWT 라서
 * verifySession 을 그대로 재사용한다.
 *
 * mobile-session.ts 가 아니라 이 파일에 두는 이유: proxy.ts(Edge)도 같은 함수를
 * 써야 하는데, mobile-session.ts 는 node:crypto 와 supabaseAdmin 을 끌어와
 * Edge 번들에 들어갈 수 없다. (모바일 저장소의 참조 구현은 이 함수를
 * mobile-session.ts 에 두고 있었다 — 옮긴 이유가 이것이다.)
 */
export async function getBearerUser(req: Request): Promise<SessionUser | null> {
  const token = bearerToken(req);
  if (!token) return null;
  const payload = await verifySession(token);
  return payload ? pickSessionUser(payload) : null;
}

export const SESSION_COOKIE = sessionEnv.cookieName;
export const GUEST_COOKIE = sessionEnv.guestCookieName;
