import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { SyncRunKind, SyncRunRow } from "@/types/db";

export async function getLastSyncRun(kind: SyncRunKind): Promise<SyncRunRow | null> {
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
