import "server-only";

import { supabaseRead } from "@/lib/supabase/read";
import type { TrendSource } from "@/types/db";
import type { FeedItem, IssueRow, TrendDetail } from "@/types/feed";

/**
 * 화면이 쓰는 읽기 쿼리 모음. 전부 anon 키로 모바일 뷰를 읽는다 (lib/supabase/read.ts).
 *
 * 열은 고른다 — search_text 는 검색할 때만 필요하고 목록마다 실어 나를 이유가 없다.
 */

const FEED_COLUMNS =
  "type,key,source,repo,title,lede,meta,published_at,open_url,host,public_id,source_variant,collected_date,score,origin_url";

// ---------------------------------------------------------------------------
// 목록 (mobile_feed — 긱뉴스 + 트렌드)
// ---------------------------------------------------------------------------

export interface FeedQuery {
  type?: "geek" | "trend";
  source?: TrendSource;
  /** 수집한 날 (KST, YYYY-MM-DD) */
  date?: string;
  limit?: number;
  /** 특정 키 제외 (머리기사 중복 노출 방지) */
  excludeKey?: string;
}

export async function getFeed(q: FeedQuery = {}): Promise<FeedItem[]> {
  // 앱과 같은 정렬 — 같은 시각에 여러 건이 들어와도 순서가 흔들리지 않게 key 를 2차로 둔다.
  let query = supabaseRead()
    .from("mobile_feed")
    .select(FEED_COLUMNS)
    .order("published_at", { ascending: false })
    .order("key", { ascending: false });

  if (q.type) query = query.eq("type", q.type);
  if (q.source) query = query.eq("source", q.source);
  if (q.date) query = query.eq("collected_date", q.date);
  if (q.excludeKey) query = query.neq("key", q.excludeKey);
  if (q.limit) query = query.limit(q.limit);

  const { data, error } = await query.returns<Omit<FeedItem, "maker">[]>();
  if (error) throw new Error(`목록 조회 실패: ${error.message}`);
  return (data ?? []).map((r) => ({ ...r, maker: null }));
}

/** 가장 최근에 수집된 날 — 오늘 수집이 아직 돌지 않았으면 어제가 된다 */
export async function getLatestCollectedDate(type: "geek" | "trend"): Promise<string | null> {
  const { data, error } = await supabaseRead()
    .from("mobile_feed")
    .select("collected_date")
    .eq("type", type)
    .order("collected_date", { ascending: false })
    .limit(1)
    .maybeSingle<{ collected_date: string }>();

  if (error) throw new Error(`최근 수집일 조회 실패: ${error.message}`);
  return data?.collected_date ?? null;
}

/**
 * 1면 머리기사 — 그날 수집분 중 GitHub 기간 별이 가장 많은 것, 없으면 그날 첫 항목.
 * items 는 같은 날의 트렌드 목록이라고 가정한다.
 */
export function pickLead(items: FeedItem[]): FeedItem | null {
  const github = items
    .filter((i) => i.source === "github")
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return github[0] ?? items[0] ?? null;
}

/** 출처별 건수 — 1면 3열의 "N건 중 M건" 표기용 */
export function countBySource(items: FeedItem[]): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, i) => {
    if (i.source) acc[i.source] = (acc[i.source] ?? 0) + 1;
    return acc;
  }, {});
}

// ---------------------------------------------------------------------------
// 트렌드 상세 (mobile_trend_detail)
// ---------------------------------------------------------------------------

/** /articles/trend/<public_id> 라우트용. 공개되지 않은 항목은 뷰에 없어 null 이다. */
export async function getTrendDetail(publicId: string): Promise<TrendDetail | null> {
  const { data, error } = await supabaseRead()
    .from("mobile_trend_detail")
    .select("*")
    .eq("public_id", publicId)
    .maybeSingle<TrendDetail>();

  if (error) throw new Error(`트렌드 상세 조회 실패: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// 마스트헤드 (mobile_issue — 항상 한 행)
// ---------------------------------------------------------------------------

export async function getIssue(): Promise<IssueRow> {
  const { data, error } = await supabaseRead()
    .from("mobile_issue")
    .select("issue_no,date,geek_count,trend_count")
    .single<IssueRow>();

  if (error) throw new Error(`발행 정보 조회 실패: ${error.message}`);
  return data;
}
