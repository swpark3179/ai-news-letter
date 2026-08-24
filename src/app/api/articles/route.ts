import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { verifyAdmin } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { readMinutes } from "@/lib/format";
import {
  TABLE_MAX_CELL_CHARS,
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  blockHasContent,
  blockPlainText,
  normalizeBlock,
} from "@/lib/blocks";
import { isHttpUrl } from "@/lib/url";
import type { ArticleRow } from "@/types/db";

export const runtime = "nodejs";

/**
 * z.object 는 모르는 키를 조용히 버린다(strictObject 가 아니다). 그래서 화면이
 * 보내는 필드를 여기에 빠뜨리면 400 이 아니라 200 이 돌아오면서 그 필드만
 * 사라진다 — payload 가 Record<string, unknown> 이라 타입 검사도 안 걸린다.
 * Block 타입에 필드를 더할 때 이 스키마를 같이 고쳐야 한다.
 */
const blockSchema = z.object({
  type: z.enum(["text", "head", "quote", "table"]),
  // 자동 저장이 몇 초마다 돌므로 블록 하나가 무한정 커지지 않게 상한을 둔다.
  // 표 블록에서는 캡션이라 비어 있을 수 있다.
  t: z.string().max(20000).default(""),
  align: z.enum(["left", "center", "right"]).optional(),
  size: z.enum(["sm", "md", "lg"]).optional(),
  color: z
    .enum(["default", "purple", "blue", "green", "red", "yellow", "gray"])
    .optional(),
  // t 에 상한을 둔 것과 같은 이유로 표도 묶는다. body 배열의 .max(200) 은
  // 블록 개수만 제한하므로, 셀·행·표 각각에 상한이 없으면 그 불변식이 깨진다.
  rows: z
    .array(z.array(z.string().max(TABLE_MAX_CELL_CHARS)).max(TABLE_MAX_COLS))
    .max(TABLE_MAX_ROWS)
    .optional(),
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
  // authorId 는 받지 않는다 — 글은 항상 세션의 본인 것이다. z.object 가 모르는
  // 키를 버리므로, 열어 둔 옛 탭이 계속 보내도 400 이 아니라 무시된다.
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
 *   - 작성자는 항상 세션의 본인이다. 대리 지정 경로는 없앴다. 관리자가 남의 글을
 *     고칠 때도 author_id 는 손대지 않으므로 원 작성자가 유지된다.
 *
 * RLS 는 정책 없이 켜져 있고 접근은 전부 service_role 이므로(0007_rls.sql),
 * 여기서 막지 않으면 아무것도 막히지 않는다.
 */
export async function POST(req: Request) {
  const user = await getSessionUser(req);
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

  /**
   * 발행하려면 본문이 있어야 한다.
   *
   * 여기가 articles.body 로 가는 유일한 통로다. body 열에 CHECK 제약이 없고
   * supabase 클라이언트도 untyped 라, 정규화를 여기서 하지 않으면 어떤 모양이든
   * 그대로 들어간다. 빈 판정은 blockHasContent 로 한다 — 캡션 없는 표는
   * `b.t.trim()` 기준으로는 빈 블록이라 저장 직전에 사라진다.
   */
  const blocks = input.body.map(normalizeBlock).filter(blockHasContent);
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
    // 표 셀도 분량에 들어간다 — b.t 만 이으면 표만 있는 글이 1분으로 나온다.
    read_minutes: readMinutes(blocks.map(blockPlainText).join(" ")),
  };

  // photo_path 와 author_id 는 이 화면에 입력 UI 가 없다. 페이로드에 넣으면
  // 저장할 때마다 기존 발표 현장 사진이 지워지고 작성자가 덮어써진다.
  // 그래서 신규 생성에서 한 번만 본인으로 찍고, 수정에서는 아예 넣지 않는다.
  if (!existing) {
    payload.author_id = user.id;
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
