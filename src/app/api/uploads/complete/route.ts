import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { verifyAdmin } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/env";
import { chunkPath, finalPath } from "@/lib/upload/paths";
import type { AttachmentRow } from "@/types/db";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({ attachmentId: z.string().uuid() });

/**
 * 조각을 순서대로 이어 붙여 최종 파일로 저장하고 임시 조각을 지운다.
 *
 * 조각을 다시 내려받아 메모리에서 합치므로 큰 파일에서는 메모리를 많이 쓴다.
 * 발표 자료(수십 MB) 기준으로는 충분하지만, 수백 MB 를 다뤄야 하면
 * Storage 의 resumable upload 로 바꾸는 편이 낫다.
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
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const bucket = db.storage.from(supabaseEnv.bucket);

  const { data: att } = await db
    .from("attachments")
    .select("*")
    .eq("id", parsed.attachmentId)
    .maybeSingle<AttachmentRow>();

  if (!att) {
    return NextResponse.json({ error: "업로드 기록을 찾을 수 없습니다." }, { status: 404 });
  }
  // 소유권 확인은 stored 조기 반환보다 먼저 — 남의 업로드 상태를 캐낼 수 없게 한다.
  if (att.uploaded_by !== user.id && !(await verifyAdmin(user))) {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }
  if (att.status === "stored") {
    return NextResponse.json({ ok: true, storagePath: att.storage_path });
  }

  await db
    .from("attachments")
    .update({ status: "assembling" })
    .eq("id", att.id);

  try {
    // --- 조각 내려받아 순서대로 연결 --------------------------------------
    const parts: Uint8Array[] = [];
    for (let i = 0; i < att.chunk_count; i++) {
      const { data, error } = await bucket.download(chunkPath(att.id, i));
      if (error || !data) {
        throw new Error(`조각 ${i + 1}/${att.chunk_count} 을 찾을 수 없습니다.`);
      }
      parts.push(new Uint8Array(await data.arrayBuffer()));
    }

    const total = parts.reduce((n, p) => n + p.length, 0);
    if (total !== att.size_bytes) {
      throw new Error(
        `크기가 맞지 않습니다 — 기대 ${att.size_bytes}B, 실제 ${total}B`,
      );
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      merged.set(p, offset);
      offset += p.length;
    }

    // --- 최종 저장 ---------------------------------------------------------
    const storagePath = finalPath(att.id, att.file_name);
    const { error: upErr } = await bucket.upload(storagePath, merged, {
      contentType: att.mime_type ?? "application/octet-stream",
      upsert: true,
    });
    if (upErr) throw new Error(`최종 저장 실패: ${upErr.message}`);

    // --- 임시 조각 정리 ----------------------------------------------------
    await bucket.remove(
      Array.from({ length: att.chunk_count }, (_, i) => chunkPath(att.id, i)),
    );

    await db
      .from("attachments")
      .update({
        status: "stored",
        storage_path: storagePath,
        received_chunks: att.chunk_count,
        completed_at: new Date().toISOString(),
        // 업로드가 끝났으므로 임시 키를 지운다.
        encryption_key: null,
        error: null,
      })
      .eq("id", att.id);

    return NextResponse.json({ ok: true, storagePath });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "조립에 실패했습니다.";
    await db
      .from("attachments")
      .update({ status: "failed", error: msg })
      .eq("id", att.id);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
