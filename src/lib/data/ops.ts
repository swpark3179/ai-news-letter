import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { supabaseEnv } from "@/lib/env";
import type { AttachmentRow, SyncRunRow } from "@/types/db";

export async function getLastSyncRun(
  kind: "geeknews" | "trend",
): Promise<SyncRunRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("sync_runs")
    .select("*")
    .eq("kind", kind)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle<SyncRunRow>();

  if (error) return null;
  return data;
}

export async function getRecentSyncRuns(limit = 10): Promise<SyncRunRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("sync_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit)
    .returns<SyncRunRow[]>();

  if (error) return [];
  return data ?? [];
}

export async function getSyncRun(id: string): Promise<SyncRunRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("sync_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle<SyncRunRow>();

  if (error) return null;
  return data;
}

export async function getAttachments(limit = 30): Promise<AttachmentRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("attachments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<AttachmentRow[]>();

  if (error) return [];
  return data ?? [];
}

export async function getAttachment(id: string): Promise<AttachmentRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("attachments")
    .select("*")
    .eq("id", id)
    .maybeSingle<AttachmentRow>();

  if (error) return null;
  return data;
}

/**
 * 기사에 붙은 발표 자료 1건.
 *
 * 예전에는 화면이 getAttachments(50) 를 받아 .find() 로 골랐는데,
 * 업로드가 50건을 넘으면 오래된 기사의 자료가 조용히 사라졌다.
 */
export async function getArticleAttachment(
  articleId: string,
): Promise<AttachmentRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("attachments")
    .select("*")
    .eq("article_id", articleId)
    .eq("status", "stored")
    .order("completed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<AttachmentRow>();

  if (error) return null;
  return data;
}

/** Storage 오브젝트 경로 → 공개 URL. 버킷이 private 이면 서명 URL 로 바꿔야 한다. */
export function storageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const { data } = supabaseAdmin().storage.from(supabaseEnv.bucket).getPublicUrl(path);
  return data.publicUrl ?? null;
}
