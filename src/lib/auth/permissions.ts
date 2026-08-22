import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { SessionUser } from "@/lib/auth/session";

/**
 * 글 작성·수정·삭제 권한 판정.
 *
 * RLS 는 정책 없이 켜져 있고 모든 접근이 service_role 이라(0007_rls.sql),
 * DB 는 아무것도 막아 주지 않는다. 권한은 전부 여기서 판단한다.
 *
 * 두 층으로 나눈 이유:
 *   canEditArticle — JWT 의 isAdmin 을 믿는 낙관적 판정. 버튼을 그릴지 정할 때.
 *   verifyAdmin    — members.is_admin 을 DB 에서 다시 읽는다. 권한이 회수된 뒤에도
 *                    오래된 쿠키로 남의 글을 건드릴 수 있으므로, 실제 변경 직전에 쓴다.
 */

/** 글을 새로 쓸 수 있는가 — 로그인 회원이면 전부. 게스트는 세션이 없어 false. */
export function canWriteArticle(user: SessionUser | null): user is SessionUser {
  return !!user;
}

/** 화면 렌더용 낙관적 판정. 본인 글이거나 관리자면 true. */
export function canEditArticle(
  user: SessionUser | null,
  article: { author_id: string | null },
): boolean {
  if (!user) return false;
  return user.isAdmin || (!!article.author_id && article.author_id === user.id);
}

/** members.is_admin 을 DB 에서 다시 확인한다. 타인 글 변경/삭제 직전에만 호출. */
export async function verifyAdmin(user: SessionUser): Promise<boolean> {
  if (!user.isAdmin) return false;

  const { data } = await supabaseAdmin()
    .from("members")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();

  return data?.is_admin === true;
}
