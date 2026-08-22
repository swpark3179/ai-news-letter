import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { verifyAdmin } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { MAX_SINGLE_TRANSFER_BYTES } from "@/lib/domain";

export const runtime = "nodejs";

/** 조각 하나는 게이트웨이 한도(10MB)보다 확실히 작아야 한다. */
const MAX_CHUNK_BYTES = 9 * 1024 * 1024;
const MAX_FILE_BYTES = 500 * 1024 * 1024;

const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  sizeBytes: z.number().int().positive().max(MAX_FILE_BYTES),
  mimeType: z.string().max(255).optional(),
  chunkSizeBytes: z.number().int().positive().max(MAX_CHUNK_BYTES),
  articleId: z.string().uuid().nullable().optional(),
});

/**
 * 분할 업로드 시작.
 *
 * 이 업로드 전용 AES-256-GCM 키를 서버가 만들어 attachments 행에 보관하고
 * HTTPS 응답으로 클라이언트에 내려준다. 업로드가 끝나면 키를 지운다.
 * (전송 구간 이중 보호가 목적이고, 저장 시점 암호화는 Storage 가 담당한다.)
 */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "잘못된 업로드 요청입니다." }, { status: 400 });
  }

  // 기사에 바로 매다는 경우, 그 기사를 고칠 수 있는 사람인지 확인한다.
  // 확인하지 않으면 남의 심층 분석 글에 임의의 파일을 붙일 수 있다.
  if (parsed.articleId) {
    const { data: article } = await supabaseAdmin()
      .from("articles")
      .select("author_id")
      .eq("id", parsed.articleId)
      .maybeSingle<{ author_id: string | null }>();

    if (!article) {
      return NextResponse.json({ error: "글을 찾을 수 없습니다." }, { status: 404 });
    }
    if (article.author_id !== user.id && !(await verifyAdmin(user))) {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }
  }

  const chunkSizeBytes = Math.min(parsed.chunkSizeBytes, MAX_CHUNK_BYTES);
  const chunkCount = Math.max(1, Math.ceil(parsed.sizeBytes / chunkSizeBytes));
  const keyB64 = randomBytes(32).toString("base64");

  const { data, error } = await supabaseAdmin()
    .from("attachments")
    .insert({
      article_id: parsed.articleId ?? null,
      file_name: parsed.fileName,
      mime_type: parsed.mimeType ?? "application/octet-stream",
      size_bytes: parsed.sizeBytes,
      chunk_size_bytes: chunkSizeBytes,
      chunk_count: chunkCount,
      received_chunks: 0,
      status: "uploading",
      uploaded_by: user.id,
      encryption_key: keyB64,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    return NextResponse.json(
      { error: `업로드 기록 생성 실패: ${error?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  return NextResponse.json({
    attachmentId: data.id,
    chunkCount,
    chunkSizeBytes,
    keyB64,
    singleTransferLimit: MAX_SINGLE_TRANSFER_BYTES,
  });
}
