import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ROLE_LABEL } from "@/lib/domain";
import type { ArticleRow } from "@/types/db";

export const runtime = "nodejs";

const bodySchema = z.object({
  articleId: z.string().uuid(),
  body: z.string().trim().min(1).max(1000),
});

export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json(
      { error: "코멘트 내용을 1자 이상 1000자 이하로 입력해 주세요." },
      { status: 400 },
    );
  }

  const db = supabaseAdmin();

  // 심층 분석 기사에만 코멘트를 허용한다 (디자인 487행의 isDeep 분기).
  const { data: article } = await db
    .from("articles")
    .select("id, section, status")
    .eq("id", parsed.articleId)
    .maybeSingle<Pick<ArticleRow, "id" | "section" | "status">>();

  if (!article || article.status !== "published") {
    return NextResponse.json({ error: "기사를 찾을 수 없습니다." }, { status: 404 });
  }
  if (article.section !== "deep") {
    return NextResponse.json(
      { error: "심층 분석 기사에만 코멘트를 남길 수 있습니다." },
      { status: 400 },
    );
  }

  const { error } = await db.from("comments").insert({
    article_id: parsed.articleId,
    member_id: user.id,
    author_name: user.name,
    role_tag: ROLE_LABEL[user.role],
    body: parsed.body,
  });

  if (error) {
    return NextResponse.json(
      { error: `코멘트 저장 실패: ${error.message}` },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
