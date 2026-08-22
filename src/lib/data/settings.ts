import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { AppSettingRow } from "@/types/db";

export interface PublishSettings {
  issueNo: number;
  publisher: string;
  showEnSubtitles: boolean;
  publishHourLabel: string;
  securityNotice: string;
}

const FALLBACK: PublishSettings = {
  issueNo: 1,
  publisher: "Samsung SDS · AI Unit",
  showEnSubtitles: true,
  publishHourLabel: "07:00 KST 발행",
  securityNotice: "사내 문서 보안 등급 II · 외부 공유 금지",
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
  const str = (k: string, d: string) => {
    const v = map.get(k);
    return typeof v === "string" ? v : d;
  };
  const bool = (k: string, d: boolean) => {
    const v = map.get(k);
    return typeof v === "boolean" ? v : d;
  };

  return {
    issueNo: num("issue_no", FALLBACK.issueNo),
    publisher: str("publisher", FALLBACK.publisher),
    showEnSubtitles: bool("show_en_subtitles", FALLBACK.showEnSubtitles),
    publishHourLabel: str("publish_hour_label", FALLBACK.publishHourLabel),
    securityNotice: str("security_notice", FALLBACK.securityNotice),
  };
}
