import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { verifyAdmin } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { readMinutes } from "@/lib/format";
import { isHttpUrl } from "@/lib/url";
import type { ArticleRow } from "@/types/db";

export const runtime = "nodejs";

const blockSchema = z.object({
  type: z.enum(["text", "head", "quote"]),
  // 자동 저장이 몇 초마다 돌므로 블록 하나가 무한정 커지지 않게 상한을 둔다.
  t: z.string().max(20000),
});

const sourceSchema = z.object({
  kind: z.enum(["gh", "hn", "ax", "gk"]),
  label: z.string().max(200).nullable().optional(),
  // z.url() 은 javascript: / data: 도 통과시킨다 — 기사 화면이 이 값을
  // <a href> 로 그대로 렌더하므로 http(s) 만 받는다.
  url: z
    .string()
    .max(2000)
    .refine(isHttpUrl, { message: "http(s) 주소만 등록할 수 있습니다." }),
});

const bodySchema = z.object({
  id: z.string().uuid().optional(),
  section: z.enum(["review", "deep"]),
  title: z.string().trim().min(1).max(300),
  deck: z.string().trim().max(1000).optional().nullable(),
  body: z.array(blockSchema).max(200),
  tags: z.array(z.string().trim().max(40)).max(8),
  repoLabel: z.string().trim().max(200).optional().nullable(),
  authorId: z.string().uuid().optional().nullable(),
  status: z.enum(["draft", "published"]),
  talkDate: z.string().optional().nullable(),
  talkRoom: z.string().max(200).optional().nullable(),
  attachmentId: z.string().uuid().optional().nullable(),
  sources: z.array(sourceSchema).max(12),
});

type ExistingArticle = Pick<
  ArticleRow,
  "id" | "author_id" | "status" | "published_at"
>;

/**
 * 글 저장 — 신규 생성과 수정을 겸한다. status 로 임시 저장 / 발행을 구분한다.
 *
 * 권한:
 *   - 로그인한 회원이면 누구나 새 글을 쓸 수 있다 (게스트는 세션이 없어 401).
 *   - 남의 글은 DB 에서 확인된 관리자만 고칠 수 있다.
 *
 * RLS 는 정책 없이 켜져 있고 접근은 전부 service_role 이므로(0007_rls.sql),
 * 여기서 막지 않으면 아무것도 막히지 않는다.
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let input;
  try {
    input = bodySchema.parse(await req.json());
  } catch (e) {
    const msg =
      e instanceof z.ZodError
        ? e.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")
        : "잘못된 요청입니다.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // 발행하려면 본문이 있어야 한다.
  const blocks = input.body.filter((b) => b.t.trim());
  if (input.status === "published" && blocks.length === 0) {
    return NextResponse.json(
      { error: "본문이 비어 있어 발행할 수 없습니다." },
      { status: 400 },
    );
  }

  const db = supabaseAdmin();

  // 계정이 살아 있는지 확인한다. 세션 JWT 는 8시간짜리라 비활성화된 뒤에도 남는다.
  const { data: me } = await db
    .from("members")
    .select("is_active")
    .eq("id", user.id)
    .maybeSingle<{ is_active: boolean }>();

  if (!me?.is_active) {
    return NextResponse.json({ error: "비활성 계정입니다." }, { status: 403 });
  }

  // --- 수정이면 기존 행을 먼저 읽어 권한을 확인한다 -------------------------
  let existing: ExistingArticle | null = null;
  let isAdmin = false;

  if (input.id) {
    const { data } = await db
      .from("articles")
      .select("id, author_id, status, published_at")
      .eq("id", input.id)
      .maybeSingle<ExistingArticle>();

    if (!data) {
      return NextResponse.json({ error: "글을 찾을 수 없습니다." }, { status: 404 });
    }
    existing = data;

    if (existing.author_id !== user.id) {
      isAdmin = await verifyAdmin(user);
      if (!isAdmin) {
        return NextResponse.json(
          { error: "본인이 쓴 글만 수정할 수 있습니다." },
          { status: 403 },
        );
      }
    }
  }

  // 작성자 대리 지정은 관리자만. 그 외에는 세션의 본인으로 강제한다.
  let authorId: string | undefined;
  if (input.authorId && input.authorId !== user.id) {
    if (!isAdmin) isAdmin = await verifyAdmin(user);
    if (isAdmin) authorId = input.authorId;
  } else if (input.authorId) {
    authorId = input.authorId;
  }

  const now = new Date().toISOString();

  /**
   * 최초 발행 시각은 한 번만 찍는다. 예전에는 저장할 때마다
   * status==='published' ? now : null 로 덮어써서 수정할 때마다 발행일이
   * 오늘로 밀리고, 임시 저장하면 발행일이 아예 지워졌다.
   */
  const publishedAt =
    input.status === "published"
      ? (existing?.published_at ?? now)
      : (existing?.published_at ?? null);

  const payload: Record<string, unknown> = {
    section: input.section,
    title: input.title,
    deck: input.deck?.trim() || null,
    body: blocks,
    tags: input.tags.filter(Boolean),
    repo_label: input.section === "review" ? input.repoLabel?.trim() || null : null,
    status: input.status,
    published_at: publishedAt,
    talk_date: input.section === "deep" && input.talkDate ? input.talkDate : null,
    talk_room: input.section === "deep" ? input.talkRoom?.trim() || null : null,
    read_minutes: readMinutes(blocks.map((b) => b.t).join(" ")),
  };

  // photo_path 는 이 화면에 입력 UI 가 없다. 페이로드에 넣으면 저장할 때마다
  // 기존 발표 현장 사진이 지워진다.
  if (!existing) {
    payload.author_id = authorId ?? user.id;
  } else if (authorId) {
    payload.author_id = authorId;
  }

  let articleId = existing?.id ?? null;

  if (articleId) {
    const { error } = await db.from("articles").update(payload).eq("id", articleId);
    if (error) {
      return NextResponse.json({ error: `수정 실패: ${error.message}` }, { status: 500 });
    }
  } else {
    const { data, error } = await db
      .from("articles")
      .insert(payload)
      .select("id")
      .single<{ id: string }>();
    if (error || !data) {
      return NextResponse.json(
        { error: `저장 실패: ${error?.message ?? "unknown"}` },
        { status: 500 },
      );
    }
    articleId = data.id;
  }

  // 원문 소스는 통째로 교체한다 (편집 화면이 전체 목록을 보내므로).
  const { error: delErr } = await db
    .from("article_sources")
    .delete()
    .eq("article_id", articleId);
  if (delErr) {
    return NextResponse.json(
      { error: `원문 소스 갱신 실패: ${delErr.message}` },
      { status: 500 },
    );
  }

  const sources = input.sources.filter((s) => s.url.trim());
  if (sources.length > 0) {
    const { error: insErr } = await db.from("article_sources").insert(
      sources.map((s, i) => ({
        article_id: articleId,
        kind: s.kind,
        label: s.label?.trim() || null,
        url: s.url.trim(),
        seq: i,
      })),
    );
    if (insErr) {
      return NextResponse.json(
        { error: `원문 소스 저장 실패: ${insErr.message}` },
        { status: 500 },
      );
    }
  }

  // 업로드한 발표 자료를 이 기사에 연결한다.
  // 본인이 올린 것만 — 그렇지 않으면 남의 첨부를 내 기사에 매달 수 있다.
  if (input.attachmentId) {
    let link = db
      .from("attachments")
      .update({ article_id: articleId })
      .eq("id", input.attachmentId);
    if (!isAdmin) link = link.eq("uploaded_by", user.id);
    await link;
  }

  return NextResponse.json({ id: articleId, status: input.status });
}
