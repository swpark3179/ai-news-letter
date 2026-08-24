import "server-only";

import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";
import { socialAuthEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { toSessionUser } from "@/lib/auth/current-user";
import {
  createMemberForIdentity,
  findMemberByEmail,
  findMemberBySubject,
  identityEmails,
  SocialAuthError,
  type LinkResult,
} from "@/lib/auth/social-identity";

/**
 * 모바일 앱의 Apple 로그인을 members 에 잇는다.
 *
 * 앱은 네이티브 시트(iOS) 또는 Apple 의 웹 인증 화면(Android)에서 ID 토큰을
 * 받아 그대로 보낸다. Google 과 마찬가지로 액세스 토큰이 아니라 ID 토큰인
 * 이유는, 우리가 필요한 것이 "Apple API 호출 권한"이 아니라 "이 사람이
 * 누구인지에 대한 Apple 의 서명된 진술"이기 때문이다.
 *
 * Google 과 다른 점 세 가지 — 코드가 이 세 가지 때문에 갈린다.
 *
 *  1. **이름과 메일을 최초 인증 때 한 번만 준다.** 놓치면 다시 받을 수 없으므로
 *     그 자리에서 저장한다. 이름은 앱이 조립해 보내 주고(표시용), 계정을
 *     찾는 데 쓰는 이메일은 **토큰 안의 값만** 믿는다 — 아래 참고.
 *  2. **「이메일 가리기」** 를 고르면 `@privaterelay.appleid.com` 릴레이 주소가
 *     온다. 실제 주소가 아니므로 앱이 사람에게 그대로 보여 주지 않는다.
 *  3. **nonce 를 검사한다.** Apple 은 앱이 준 1회용 값을 토큰에 실어 돌려주므로,
 *     가로챈 토큰을 다시 보내는 재생 공격을 여기서 막을 수 있다.
 */

const APPLE_ISSUER = "https://appleid.apple.com";

/** Apple 의 공개키. jose 가 캐시하고 필요할 때만 다시 받아 온다. */
const APPLE_JWKS = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);

export interface AppleClaims {
  sub: string;
  /** 검증된 메일. 없을 수 있다 — 재로그인 때 토큰에서 빠지는 경우가 있다. */
  email: string | null;
  emailVerified: boolean;
  isPrivateEmail: boolean;
}

/**
 * Apple 이 서명한 ID 토큰을 검증하고 클레임을 돌려준다.
 *
 * [rawNonce] 는 앱이 인증 요청에 실었던 1회용 값의 **원문**이다.
 * 값을 주면 토큰의 `nonce` 클레임과 맞춰 본다.
 */
export async function verifyAppleIdToken(
  idToken: string,
  rawNonce?: string,
): Promise<AppleClaims> {
  // 허용 aud 는 socialAuthEnv 에서 읽는다(env.ts) — iOS 는 번들 ID, Android 는
  // Services ID 다. Google 과 달리 「서버용 클라이언트 ID」 개념이 없어 플랫폼마다
  // aud 가 다르므로 목록으로 받는다.
  const audiences = socialAuthEnv.appleAudiences;
  if (audiences.length === 0) {
    throw new SocialAuthError("서버에 Apple 클라이언트 ID 가 설정되지 않았습니다.", 500);
  }

  let payload: JWTPayload;
  try {
    // jwtVerify 가 서명·exp·iss·aud 를 함께 검사한다.
    ({ payload } = await jwtVerify(idToken, APPLE_JWKS, {
      issuer: APPLE_ISSUER,
      audience: audiences,
    }));
  } catch {
    throw new SocialAuthError("Apple 계정 확인에 실패했습니다.");
  }

  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  if (!sub) {
    throw new SocialAuthError("Apple 계정 확인에 실패했습니다.");
  }

  assertNonce(payload.nonce, rawNonce);

  // Apple 은 불리언과 문자열 "true" 를 섞어 보낸다 — 둘 다 받아 준다.
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  return {
    sub,
    email: email.length > 0 ? email : null,
    emailVerified: isTrue(payload.email_verified),
    isPrivateEmail: isTrue(payload.is_private_email),
  };
}

/**
 * 토큰의 nonce 가 앱이 만든 값과 같은지 본다.
 *
 * **원문과 sha256 해시를 모두 인정한다.** 네이티브 흐름은 앱이 준 값을 그대로
 * 담아 주는데, 웹 인증 흐름은 Apple 이 sha256 해시로 바꿔 담기 때문이다.
 * 해시 표현(16진수·base64url)도 문서에 못 박혀 있지 않아 양쪽을 본다.
 *
 * 앱이 nonce 를 보내지 않았으면(구버전) 검사를 건너뛴다 — 토큰 자체는
 * Apple 서명·aud·exp 로 이미 검증됐고, 앱 업데이트가 퍼지면 이 분기는 사라진다.
 */
function assertNonce(claim: unknown, rawNonce?: string): void {
  if (!rawNonce) return;

  const claimed = typeof claim === "string" ? claim : "";
  const digest = createHash("sha256").update(rawNonce).digest();
  const accepted = [
    rawNonce,
    digest.toString("hex"),
    digest.toString("base64url"),
  ];

  if (!accepted.includes(claimed)) {
    throw new SocialAuthError("로그인 요청이 일치하지 않습니다. 다시 시도해 주세요.");
  }
}

function isTrue(v: unknown): boolean {
  return v === true || v === "true";
}

/**
 * 검증된 클레임을 members 에 잇는다. 없으면 만든다.
 *
 * 연결 규칙은 Google 과 같다 (모바일 저장소 docs/05-account-linking.md):
 *   1) apple_sub 로 이미 연결된 멤버 → 그 멤버
 *   2) 검증된 이메일과 같은 members.email → 그 멤버에 매핑 생성
 *   3) 둘 다 실패 → 새 members 행 (emp_no = `apple:<sub>`)
 *
 * [displayName] 은 앱이 최초 인증에서 받아 보내 주는 이름이다. 서명된 값이
 * 아니므로 **표시에만** 쓴다. 계정을 찾는 데는 쓰지 않는다.
 */
export async function linkAppleIdentity(
  claims: AppleClaims,
  displayName?: string,
): Promise<LinkResult> {
  // ── 1) 이미 연결된 Apple 계정 ───────────────────────────────────
  const linked = await findMemberBySubject("apple", claims.sub);
  if (linked) {
    await touchIdentity(claims);
    return {
      user: toSessionUser(linked),
      linkedToExistingMember: true,
      emails: await identityEmails(linked.id),
      provider: "apple",
    };
  }

  // ── 2) 검증된 이메일로 기존 멤버 찾기 ────────────────────────────
  // 릴레이 주소로는 시도하지 않는다 — 그 주소가 members.email 에 들어 있을
  // 이유가 없고, 우연히 맞을 일도 없다.
  const matchable =
    claims.email && claims.emailVerified && !claims.isPrivateEmail
      ? claims.email
      : null;

  if (matchable) {
    const byEmail = await findMemberByEmail(matchable);
    if (byEmail) {
      await insertIdentity(byEmail.id, claims, displayName);
      return {
        user: toSessionUser(byEmail),
        linkedToExistingMember: true,
        emails: await identityEmails(byEmail.id),
        provider: "apple",
      };
    }
  }

  // ── 3) 자동 가입 ────────────────────────────────────────────────
  // 이름이 없으면 메일 아이디, 그것도 없으면(가린 메일 + 재인증) 기본 문구.
  const name =
    displayName?.trim() ||
    claims.email?.split("@")[0]?.trim() ||
    "Apple 사용자";

  const created = await createMemberForIdentity({
    provider: "apple",
    subject: claims.sub,
    name,
    // 릴레이 주소도 넣어 둔다 — members.email 은 unique 라 충돌하지 않고,
    // 나중에 사용자가 가리기를 풀면 여기서 갱신된다.
    email: claims.email,
  });

  await insertIdentity(created.id, claims, displayName);
  return {
    user: toSessionUser(created),
    linkedToExistingMember: false,
    emails: await identityEmails(created.id),
    provider: "apple",
  };
}

async function insertIdentity(
  memberId: string,
  claims: AppleClaims,
  displayName?: string,
): Promise<void> {
  await supabaseAdmin().from("member_apple_identities").insert({
    apple_sub: claims.sub,
    member_id: memberId,
    apple_email: claims.email,
    email_verified: claims.emailVerified,
    is_private_email: claims.isPrivateEmail,
    display_name: displayName?.trim() || null,
    last_login_at: new Date().toISOString(),
  });
}

/**
 * 재로그인 — 마지막 로그인 시점과 메일을 갱신한다.
 *
 * `display_name` 은 **덮어쓰지 않는다.** Apple 은 최초 인증에서만 이름을 주고
 * 그 뒤에는 비어 오므로, 덮어쓰면 처음에 받아 둔 이름을 잃는다.
 */
async function touchIdentity(claims: AppleClaims): Promise<void> {
  await supabaseAdmin()
    .from("member_apple_identities")
    .update({
      // 토큰에서 메일이 빠져 온 경우에는 기존 값을 지우지 않는다.
      ...(claims.email
        ? {
            apple_email: claims.email,
            email_verified: claims.emailVerified,
            is_private_email: claims.isPrivateEmail,
          }
        : {}),
      last_login_at: new Date().toISOString(),
    })
    .eq("apple_sub", claims.sub);
}
