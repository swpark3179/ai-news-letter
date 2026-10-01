import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { AppSettingRow } from "@/types/db";

export interface PublishSettings {
  issueNo: number;
  showEnSubtitles: boolean;
}

const FALLBACK: PublishSettings = {
  issueNo: 1,
  showEnSubtitles: true,
};

/** app_settings 전체를 읽어 화면이 쓰는 형태로 정리한다. */
export async function getPublishSettings(): Promise<PublishSettings> {
  const { data, error } = await supabaseAdmin()
    .from("app_settings")
    .select("key, value")
    .returns<Pick<AppSettingRow, "key" | "value">[]>();

  if (error || !data) return FALLBACK;

  const map = new Map(data.map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => {
    const v = map.get(k);
    return typeof v === "number" ? v : d;
  };
  const bool = (k: string, d: boolean) => {
    const v = map.get(k);
    return typeof v === "boolean" ? v : d;
  };

  return {
    issueNo: num("issue_no", FALLBACK.issueNo),
    showEnSubtitles: bool("show_en_subtitles", FALLBACK.showEnSubtitles),
  };
}
