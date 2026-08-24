import "server-only";

import { OAuth2Client, type TokenPayload } from "google-auth-library";
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
 * 모바일 앱의 Google 로그인을 members 에 잇는다.
 *
 * 앱은 Google 네이티브 로그인으로 ID 토큰을 받아 그대로 보낸다. 액세스 토큰이
 * 아니라 ID 토큰인 이유는, 우리가 필요한 것이 "Google API 호출 권한"이 아니라
 * "이 사람이 누구인지에 대한 Google 의 서명된 진술"이기 때문이다.
 *
 * 연결 규칙 세 단계는 Apple 과 공유한다 — @/lib/auth/social-identity 참고.
 * (모바일 저장소 docs/05-account-linking.md 와 같은 순서)
 */

/**
 * 인증서를 캐시하므로 모듈 수준에 한 번만 만든다.
 *
 * 인증서 요청은 gaxios 를 거치고 gaxios 7 부터는 전역 fetch 를 쓰므로,
 * instrumentation.ts 가 깔아 둔 사내 프록시 디스패처가 그대로 적용된다.
 */
const client = new OAuth2Client();

/**
 * Google 이 서명한 ID 토큰을 검증하고 클레임을 돌려준다.
 *
 * 허용 aud 와 도메인 제한은 socialAuthEnv 에서 읽는다(env.ts) — 참조 구현은
 * 모듈 최상단에서 process.env 를 읽었지만, 그러면 값이 첫 import 시점에 굳어
 * 이 저장소의 lazy getter 관례와 어긋난다.
 */
export async function verifyGoogleIdToken(idToken: string): Promise<TokenPayload> {
  const audiences = socialAuthEnv.googleAudiences;
  if (audiences.length === 0) {
    throw new SocialAuthError("서버에 Google 클라이언트 ID 가 설정되지 않았습니다.", 500);
  }

  let payload: TokenPayload | undefined;
  try {
    // verifyIdToken 이 서명·exp·iss(accounts.google.com)·aud 를 함께 검사한다.
    // tokeninfo 엔드포인트는 디버깅용이므로 운영에서 쓰지 않는다.
    const ticket = await client.verifyIdToken({ idToken, audience: audiences });
    payload = ticket.getPayload();
  } catch {
    throw new SocialAuthError("Google 계정 확인에 실패했습니다.");
  }

  if (!payload?.sub) {
    throw new SocialAuthError("Google 계정 확인에 실패했습니다.");
  }
  // 이메일로 기존 계정을 찾을 것이므로, 검증되지 않은 이메일은 신뢰하지 않는다.
  if (payload.email_verified !== true || !payload.email) {
    throw new SocialAuthError("이메일이 확인되지 않은 Google 계정입니다.", 403);
  }

  // 허용 도메인을 비워 두면 제한하지 않는다 — 현재 방침이 그렇다.
  // 사내로 잠글 때는 ALLOWED_HOSTED_DOMAINS=samsung.com 만 넣으면 되고 코드는
  // 손대지 않는다. 단 Apple 에는 대응하는 클레임(hd)이 없어 이쪽만 잠가서는
  // 사내 전용이 되지 않는다 — docs/MOBILE_OAUTH2.md 의 「나중에 잠글 때」.
  const allowedDomains = socialAuthEnv.allowedGoogleDomains;
  if (allowedDomains.length > 0) {
    // hd 는 Google 이 서명한 토큰 안에 들어 있어 신뢰할 수 있다.
    // 이메일 접미사 검사보다 강하다 (개인 Gmail 은 hd 를 위조할 수 없다).
    const hd = (payload.hd ?? "").toLowerCase();
    if (!allowedDomains.includes(hd)) {
      throw new SocialAuthError("사내 계정으로만 로그인할 수 있습니다.", 403);
    }
  }

  return payload;
}

/** 검증된 클레임을 members 에 잇는다. 없으면 만든다. */
export async function linkGoogleIdentity(payload: TokenPayload): Promise<LinkResult> {
  const sub = payload.sub!;
  const email = payload.email!.trim();
  const name = (payload.name ?? email.split("@")[0]).trim();

  // ── 1) 이미 연결된 Google 계정 ──────────────────────────────────
  const linked = await findMemberBySubject("google", sub);
  if (linked) {
    await touchIdentity(sub, payload);
    return {
      user: toSessionUser(linked),
      linkedToExistingMember: true,
      emails: await identityEmails(linked.id),
      provider: "google",
    };
  }

  // ── 2) 검증된 이메일로 기존 멤버 찾기 ────────────────────────────
  // members.email 은 nullable 이고 시드 계정들은 비어 있다. 그래서 여기서
  // 못 찾는 경우가 실제로 생기고, 그때 3) 으로 내려간다.
  const byEmail = await findMemberByEmail(email);
  if (byEmail) {
    await insertIdentity(byEmail.id, payload);
    return {
      user: toSessionUser(byEmail),
      linkedToExistingMember: true,
      emails: await identityEmails(byEmail.id),
      provider: "google",
    };
  }

  // ── 3) 자동 가입 ────────────────────────────────────────────────
  const created = await createMemberForIdentity({
    provider: "google",
    subject: sub,
    name,
    email,
  });

  await insertIdentity(created.id, payload);
  return {
    user: toSessionUser(created),
    linkedToExistingMember: false,
    emails: await identityEmails(created.id),
    provider: "google",
  };
}

async function insertIdentity(memberId: string, p: TokenPayload): Promise<void> {
  await supabaseAdmin().from("member_google_identities").insert({
    google_sub: p.sub!,
    member_id: memberId,
    google_email: p.email!,
    email_verified: p.email_verified === true,
    hosted_domain: p.hd ?? null,
    display_name: p.name ?? null,
    picture_url: p.picture ?? null,
    last_login_at: new Date().toISOString(),
  });
}

async function touchIdentity(sub: string, p: TokenPayload): Promise<void> {
  await supabaseAdmin()
    .from("member_google_identities")
    .update({
      google_email: p.email!,
      email_verified: p.email_verified === true,
      hosted_domain: p.hd ?? null,
      display_name: p.name ?? null,
      picture_url: p.picture ?? null,
      last_login_at: new Date().toISOString(),
    })
    .eq("google_sub", sub);
}
