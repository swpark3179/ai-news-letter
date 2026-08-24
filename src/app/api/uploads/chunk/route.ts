import { createDecipheriv } from "node:crypto";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/current-user";
import { verifyAdmin } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/env";
import { chunkPath, chunkPrefix } from "@/lib/upload/paths";
import type { AttachmentRow } from "@/types/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * 암호화된 조각 하나를 받아 복호화하고 임시 경로에 저장한다.
 *
 * 요청 본문 = [IV(12B) | ciphertext + GCM tag(16B)]
 */
export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const attachmentId = req.headers.get("x-attachment-id");
  const indexRaw = req.headers.get("x-chunk-index");
  const index = Number(indexRaw);

  if (!attachmentId || !Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: "조각 헤더가 잘못되었습니다." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: att } = await db
    .from("attachments")
    .select("*")
    .eq("id", attachmentId)
    .maybeSingle<AttachmentRow>();

  if (!att) {
    return NextResponse.json({ error: "업로드 기록을 찾을 수 없습니다." }, { status: 404 });
  }
  // 헤더의 attachment id 만 맞으면 남의 업로드에 조각을 밀어 넣을 수 있었다.
  if (att.uploaded_by !== user.id && !(await verifyAdmin(user))) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }
  if (att.status !== "uploading") {
    return NextResponse.json(
      { error: `업로드 상태가 ${att.status} 라 조각을 받을 수 없습니다.` },
      { status: 409 },
    );
  }
  if (!att.encryption_key) {
    return NextResponse.json({ error: "복호화 키가 없습니다." }, { status: 409 });
  }
  if (index >= att.chunk_count) {
    return NextResponse.json({ error: "조각 번호가 범위를 벗어났습니다." }, { status: 400 });
  }

  const body = Buffer.from(await req.arrayBuffer());
  if (body.length <= IV_BYTES + TAG_BYTES) {
    return NextResponse.json({ error: "조각이 비어 있습니다." }, { status: 400 });
  }

  // --- 복호화 -------------------------------------------------------------
  let plain: Buffer;
  try {
    const iv = body.subarray(0, IV_BYTES);
    const tag = body.subarray(body.length - TAG_BYTES);
    const data = body.subarray(IV_BYTES, body.length - TAG_BYTES);

    const decipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(att.encryption_key, "base64"),
      iv,
    );
    decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    // GCM 인증 실패 = 전송 중 변조 또는 키 불일치
    return NextResponse.json(
      { error: "조각 복호화에 실패했습니다 (무결성 검증 실패)." },
      { status: 400 },
    );
  }

  // --- 임시 저장 -----------------------------------------------------------
  const { error: upErr } = await db.storage
    .from(supabaseEnv.bucket)
    .upload(chunkPath(attachmentId, index), plain, {
      contentType: "application/octet-stream",
      upsert: true,
    });

  if (upErr) {
    return NextResponse.json(
      { error: `조각 저장 실패: ${upErr.message}` },
      { status: 500 },
    );
  }

  // 재전송으로 같은 조각이 두 번 와도 카운트가 부풀지 않도록 실제 개수를 센다.
  const { data: listed } = await db.storage
    .from(supabaseEnv.bucket)
    .list(chunkPrefix(attachmentId), { limit: 1000 });

  const received = listed?.length ?? att.received_chunks + 1;

  await db
    .from("attachments")
    .update({ received_chunks: received })
    .eq("id", attachmentId);

  return NextResponse.json({ ok: true, index, received, total: att.chunk_count });
}
