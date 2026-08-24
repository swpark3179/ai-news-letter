import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { toSessionUser } from "@/lib/auth/current-user";
import type { SessionUser } from "@/lib/auth/session";
import type {
  MemberAppleIdentityRow,
  MemberGoogleIdentityRow,
  MemberRow,
  SocialProvider,
} from "@/types/db";

/**
 * 소셜 로그인 ↔ members 연결의 **공통 부분**.
 *
 * Google 과 Apple 은 토큰을 검증하는 방법만 다르다. 검증이 끝난 뒤
 * "이 사람을 어느 members 행에 붙일 것인가"는 완전히 같은 규칙이라
 * (모바일 저장소 docs/05-account-linking.md) 여기 한 곳에 모아 두었다.
 *
 *   1) 이미 연결된 subject 가 있으면 그 멤버       — 재로그인
 *   2) 없으면 검증된 이메일과 같은 members.email   — 기존 웹 계정과 연동
 *   3) 그래도 없으면 새 members 행                 — 자동 가입
 *
 * 공급자별 표는 따로 둔다(member_google_identities · member_apple_identities).
 * 이유는 supabase/migrations/0011_apple_identities.sql 머리말에 적어 두었다.
 */

export type { SocialProvider };

/**
 * 공급자별 표와 열 이름. 조회 코드가 이 표만 보고 갈린다.
 *
 * `as const` 라서 `IDENTITY[p].table` 의 타입이 **문자열 리터럴 유니온**이다 —
 * 웹이 나중에 `SupabaseClient<Database>` 로 타입을 붙여도 `.from()` 이 통과한다.
 */
const IDENTITY = {
  google: {
    table: "member_google_identities",
    subject: "google_sub",
    email: "google_email",
  },
  apple: {
    table: "member_apple_identities",
    subject: "apple_sub",
    email: "apple_email",
  },
} as const satisfies Record<
  SocialProvider,
  { table: string; subject: string; email: string }
>;

/** 자동 가입 계정의 emp_no 접두사. 실제 사번(숫자 8자리)과 충돌하지 않는다. */
export function generatedEmpNo(provider: SocialProvider, subject: string): string {
  return `${provider}:${subject}`;
}

/** 사람에게 보여 줄 수 없는 자동 가입 사번인지. */
export function isGeneratedEmpNo(empNo: string): boolean {
  return empNo.startsWith("google:") || empNo.startsWith("apple:");
}

export class SocialAuthError extends Error {
  constructor(
    message: string,
    readonly status: number = 401,
  ) {
    super(message);
    this.name = "SocialAuthError";
  }
}

export interface LinkResult {
  user: SessionUser;
  /** false 면 이번 로그인으로 새로 만들어진 계정이다. */
  linkedToExistingMember: boolean;
  /** 이 계정에 붙어 있는 공급자별 메일. 앱의 계정 줄이 이걸 쓴다. */
  emails: IdentityEmails;
  provider: SocialProvider;
}

export interface IdentityEmails {
  googleEmail: string | null;
  appleEmail: string | null;
}

/**
 * 앱이 받는 `user` 객체. 세 라우트(google · apple · me)가 같은 모양을 내도록
 * 여기 한 곳에서 만든다. 계약은 모바일 저장소 docs/03-api-contract.md.
 */
export function userPayload(args: {
  user: SessionUser;
  emails: IdentityEmails;
  provider: SocialProvider | null;
  linkedToExistingMember: boolean;
}) {
  const { user, emails, provider, linkedToExistingMember } = args;
  return {
    id: user.id,
    empNo: user.empNo,
    name: user.name,
    email: emails.googleEmail ?? emails.appleEmail,
    role: user.role,
    isAdmin: user.isAdmin,
    initial: user.initial,
    avatarTone: user.avatarTone,
    googleEmail: emails.googleEmail,
    appleEmail: emails.appleEmail,
    // 앱이 「어느 메일을 계정 줄에 보여 줄지」 정하는 데 쓴다.
    authProvider: provider,
    // false 면 앱이 「사번으로 기존 계정 연결」 안내를 띄운다.
    linkedToExistingMember,
  };
}

/** subject(불변 식별자)로 이미 연결된 멤버를 찾는다. */
export async function findMemberBySubject(
  provider: SocialProvider,
  subject: string,
): Promise<MemberRow | null> {
  const { table, subject: subjectColumn } = IDENTITY[provider];
  const { data } = await supabaseAdmin()
    .from(table)
    .select("member_id")
    .eq(subjectColumn, subject)
    .maybeSingle<{ member_id: string }>();

  return data ? requireMember(data.member_id) : null;
}

/**
 * 검증된 이메일로 기존 멤버를 찾는다.
 *
 * **검증된 값만 넘길 것.** members.email 은 nullable 이고 시드 계정들은 비어
 * 있어서 여기서 못 찾는 경우가 실제로 생긴다 — 그때는 자동 가입으로 내려간다.
 */
export async function findMemberByEmail(email: string): Promise<MemberRow | null> {
  const { data } = await supabaseAdmin()
    .from("members")
    .select("*")
    .ilike("email", email)
    .maybeSingle<MemberRow>();

  return data ?? null;
}

/** 자동 가입 — 새 members 행을 만든다. */
export async function createMemberForIdentity(args: {
  provider: SocialProvider;
  subject: string;
  name: string;
  email: string | null;
}): Promise<MemberRow> {
  const { data, error } = await supabaseAdmin()
    .from("members")
    .insert({
      emp_no: generatedEmpNo(args.provider, args.subject),
      name: args.name,
      email: args.email,
      role: "subscriber",
      is_admin: false,
      // 웹의 upsertMemberFromSso 와 같은 규칙 — 이름 끝 두 글자.
      initial: args.name.slice(-2),
      avatar_tone: "gray",
    })
    .select("*")
    .single<MemberRow>();

  if (error || !data) {
    throw new SocialAuthError(
      `계정을 만들지 못했습니다: ${error?.message ?? "unknown"}`,
      500,
    );
  }
  return data;
}

export async function requireMember(id: string): Promise<MemberRow> {
  const { data } = await supabaseAdmin()
    .from("members")
    .select("*")
    .eq("id", id)
    .maybeSingle<MemberRow>();
  if (!data) throw new SocialAuthError("계정을 찾을 수 없습니다.", 404);
  if (!data.is_active) throw new SocialAuthError("사용할 수 없는 계정입니다.", 403);
  return data;
}

/** 이 멤버에 붙어 있는 공급자별 메일. 없으면 null. */
export async function identityEmails(memberId: string): Promise<IdentityEmails> {
  const [google, apple] = await Promise.all([
    identityRow("google", memberId),
    identityRow("apple", memberId),
  ]);
  return {
    googleEmail: google?.email ?? null,
    appleEmail: apple?.email ?? null,
  };
}

/**
 * 가장 최근에 쓴 로그인 수단. 앱의 계정 줄이 어느 메일을 보여 줄지 정하는 데 쓴다.
 *
 * 액세스 토큰(JWT)에는 공급자를 담지 않는다 — 웹 세션과 **같은 페이로드**를
 * 유지해야 `getSessionUser()` 를 그대로 재사용할 수 있기 때문이다. 그래서
 * last_login_at 으로 되짚는다.
 */
export async function lastUsedProvider(
  memberId: string,
): Promise<SocialProvider | null> {
  const [google, apple] = await Promise.all([
    identityRow("google", memberId),
    identityRow("apple", memberId),
  ]);
  if (!google && !apple) return null;
  if (!apple) return "google";
  if (!google) return "apple";

  const g = google.last_login_at ? Date.parse(google.last_login_at) : 0;
  const a = apple.last_login_at ? Date.parse(apple.last_login_at) : 0;
  return a > g ? "apple" : "google";
}

/**
 * 공급자별 매핑 한 줄. 열 이름이 공급자마다 달라 동적으로 조립한다.
 *
 * `select()` 에 템플릿 리터럴을 넘기므로 결과 타입을 정적으로 잡을 수 없다.
 * 이 저장소의 Supabase 클라이언트에는 Database 제네릭이 붙어 있지 않아
 * (src/lib/supabase/server.ts) 지금은 이 형태가 맞다 — 나중에 생성 타입을
 * 도입하면 MemberGoogleIdentityRow · MemberAppleIdentityRow 로 좁힐 수 있다.
 */
type IdentityPeek = Pick<
  MemberGoogleIdentityRow & MemberAppleIdentityRow,
  "last_login_at"
> & { email: string | null };

async function identityRow(
  provider: SocialProvider,
  memberId: string,
): Promise<IdentityPeek | null> {
  const { table, email } = IDENTITY[provider];
  const { data } = await supabaseAdmin()
    .from(table)
    .select(`${email}, last_login_at`)
    .eq("member_id", memberId)
    .order("last_login_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<Record<string, string | null>>();

  if (!data) return null;
  return { email: data[email] ?? null, last_login_at: data.last_login_at ?? null };
}

/**
 * 사번으로 기존 멤버에 이어 붙인다.
 *
 * 자동 가입으로 만들어진 계정을 쓰던 사람이 「웹에서 쓰던 계정 연결」을 눌렀을 때
 * 온다. 두 공급자 모두 같은 경로다 — 매핑을 옮기고, 임시 계정은 지운다.
 *
 * ⚠ 이 경로는 사번의 소유를 증명하지 않는다. 사번은 동료들이 아는 8자리 숫자이고,
 * 여기서 확인하는 것은 「그 사번의 계정에 아직 소셜 계정이 안 붙어 있다」뿐이다.
 * 즉 개인 Google 계정으로 자동 가입한 사람이 임의의 사번을 주장할 수 있다.
 *
 * 그래서 **관리자 계정은 아예 대상에서 뺀다** — 그게 없으면 개인 메일 하나로
 * 관리자 콘솔까지 올라가는 길이 열린다. 관리자는 웹에서 사내 SSO 로 한 번
 * 로그인하면 upsertMemberFromSso 가 members.email 을 채우고, 그 뒤에는
 * 연결 규칙 2단계(검증된 이메일 매칭)가 자동으로 이어 붙인다.
 *
 * 제대로 막으려면 사번 소유 증명(사내 메일로 보낸 확인 코드 등)이 필요하다.
 * docs/MOBILE_OAUTH2.md 의 「사번 연결의 한계」에 남겨 두었다.
 */
export async function claimMemberByEmpNo(
  currentMemberId: string,
  empNo: string,
): Promise<SessionUser> {
  const db = supabaseAdmin();

  const current = await requireMember(currentMemberId);
  if (!isGeneratedEmpNo(current.emp_no)) {
    throw new SocialAuthError("이미 사내 계정에 연결되어 있습니다.", 409);
  }

  const { data: target } = await db
    .from("members")
    .select("*")
    .eq("emp_no", empNo)
    .maybeSingle<MemberRow>();

  // 없음 · 비활성 · 관리자를 같은 404 로 묶는다. 응답을 갈라 놓으면 사번 존재
  // 여부를 확인하는 도구가 된다.
  if (!target || !target.is_active || target.is_admin) {
    throw new SocialAuthError("그 사번의 계정을 찾을 수 없습니다.", 404);
  }

  // 이미 다른 소셜 계정이 붙어 있으면 덮어쓰지 않는다 — 계정 탈취 경로가 된다.
  // Google 과 Apple **양쪽**을 본다.
  for (const provider of ["google", "apple"] as const) {
    const { table, subject } = IDENTITY[provider];
    const { count } = await db
      .from(table)
      .select(subject, { count: "exact", head: true })
      .eq("member_id", target.id);

    if ((count ?? 0) > 0) {
      throw new SocialAuthError(
        "그 계정에는 이미 다른 소셜 계정이 연결되어 있습니다. 관리자에게 문의해 주세요.",
        409,
      );
    }
  }

  // 매핑을 옮긴다. 한 사람이 두 수단을 다 붙였을 수 있어 양쪽을 옮긴다.
  for (const provider of ["google", "apple"] as const) {
    const { error } = await db
      .from(IDENTITY[provider].table)
      .update({ member_id: target.id })
      .eq("member_id", current.id);

    if (error) {
      throw new SocialAuthError(`연결하지 못했습니다: ${error.message}`, 500);
    }
  }

  // 임시 계정이 담아 둔 스크랩을 옮긴 뒤 계정을 지운다.
  await moveScraps(current.id, target.id);
  await db.from("members").delete().eq("id", current.id);

  return toSessionUser(target);
}

/** scraps 를 옮긴다. 복합 PK 라 중복은 무시하고 넣는다. */
async function moveScraps(fromId: string, toId: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: rows } = await db
    .from("scraps")
    .select("target_type, target_key, created_at")
    .eq("member_id", fromId);

  if (!rows?.length) return;

  await db.from("scraps").upsert(
    rows.map((r) => ({ ...r, member_id: toId })),
    { onConflict: "member_id,target_type,target_key", ignoreDuplicates: true },
  );
  await db.from("scraps").delete().eq("member_id", fromId);
}
