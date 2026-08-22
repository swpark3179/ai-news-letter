import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/current-user";
import { verifyAdmin } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/env";
import { chunkPrefix } from "@/lib/upload/paths";
import type { ArticleRow, AttachmentRow } from "@/types/db";

export const runtime = "nodejs";

/**
 * 글 삭제 — 작성자 본인 또는 DB 에서 확인된 관리자만.
 *
 * 세션 쿠키는 sameSite=lax 라 크로스 사이트에서 이 DELETE 를 부를 수 없다.
 * (sessionCookieOptions 참고 — 별도 CSRF 토큰을 두지 않은 이유다.)
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { id } = await params;
  const db = supabaseAdmin();

  const { data: article } = await db
    .from("articles")
    .select("id, author_id, photo_path")
    .eq("id", id)
    .maybeSingle<Pick<ArticleRow, "id" | "author_id" | "photo_path">>();

  if (!article) {
    return NextResponse.json({ error: "글을 찾을 수 없습니다." }, { status: 404 });
  }

  if (article.author_id !== user.id && !(await verifyAdmin(user))) {
    return NextResponse.json(
      { error: "본인이 쓴 글만 삭제할 수 있습니다." },
      { status: 403 },
    );
  }

  // Storage 경로는 삭제 전에 모아 둔다. attachments.article_id 가
  // ON DELETE CASCADE 라(0005_ops.sql) 기사를 지우면 storage_path 를 잃는다.
  const paths = await collectStoragePaths(id, article.photo_path);

  const { error } = await db.from("articles").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: `삭제 실패: ${error.message}` }, { status: 500 });
  }

  // 파일 정리는 실패해도 삭제 자체를 되돌리지 않는다.
  // 남은 바이트는 눈에 띄지 않지만, 지워지지 않는 글은 사용자에게 바로 보인다.
  await purge(paths);

  return NextResponse.json({ ok: true });
}

/** 최종 저장본 + 업로드 중 남은 임시 조각 + 발표 현장 사진 */
async function collectStoragePaths(
  articleId: string,
  photoPath: string | null,
): Promise<string[]> {
  const db = supabaseAdmin();
  const bucket = db.storage.from(supabaseEnv.bucket);
  const paths: string[] = [];

  if (photoPath) paths.push(photoPath);

  const { data: atts } = await db
    .from("attachments")
    .select("id, storage_path, status")
    .eq("article_id", articleId)
    .returns<Pick<AttachmentRow, "id" | "storage_path" | "status">[]>();

  for (const att of atts ?? []) {
    if (att.storage_path) {
      paths.push(att.storage_path);
      continue;
    }
    // 완료되지 않은 업로드는 tmp/<id>/00000 형태의 조각으로만 남아 있다.
    const prefix = chunkPrefix(att.id);
    const { data: chunks } = await bucket.list(prefix);
    for (const c of chunks ?? []) paths.push(`${prefix}/${c.name}`);
  }

  return paths;
}

async function purge(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const bucket = supabaseAdmin().storage.from(supabaseEnv.bucket);

  // storage.remove 는 한 번에 1000개까지 받는다.
  for (let i = 0; i < paths.length; i += 1000) {
    try {
      await bucket.remove(paths.slice(i, i + 1000));
    } catch {
      // 무시 — 고아 파일은 나중에 청소할 수 있다.
    }
  }
}
