import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { kstDateString } from "@/lib/format";
import type { GeekNewsRow, TrendItemRow, TrendSource } from "@/types/db";

/**
 * 화면이 쓰는 읽기 쿼리 모음.
 * 전부 서버에서 service_role 키로 실행된다 (RLS 우회).
 */

// ---------------------------------------------------------------------------
// 긱뉴스
// ---------------------------------------------------------------------------

export async function getGeekNews(limit = 8): Promise<GeekNewsRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("geek_news")
    .select("*")
    .eq("is_hidden", false)
    .order("published_at", { ascending: false })
    .limit(limit)
    .returns<GeekNewsRow[]>();

  if (error) throw new Error(`긱뉴스 조회 실패: ${error.message}`);
  return data ?? [];
}

export async function countGeekNewsToday(): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("geek_news")
    .select("url", { count: "exact", head: true })
    .eq("collected_date", kstDateString());

  if (error) return 0;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// 트렌드 브리핑
// ---------------------------------------------------------------------------

export interface TrendQuery {
  /** 퍼온 날짜(KST, YYYY-MM-DD). 생략하면 전체 기간. */
  date?: string;
  source?: TrendSource;
  limit?: number;
  /** 특정 URL 제외 (머리기사 중복 노출 방지) */
  excludeUrl?: string;
}

export async function getTrendItems(q: TrendQuery = {}): Promise<TrendItemRow[]> {
  let query = supabaseAdmin()
    .from("trend_items")
    .select("*")
    .eq("status", "published")
    .order("collected_date", { ascending: false })
    .order("collected_at", { ascending: false });

  if (q.date) query = query.eq("collected_date", q.date);
  if (q.source) query = query.eq("source", q.source);
  if (q.excludeUrl) query = query.neq("source_url", q.excludeUrl);
  if (q.limit) query = query.limit(q.limit);

  const { data, error } = await query.returns<TrendItemRow[]>();
  if (error) throw new Error(`트렌드 브리핑 조회 실패: ${error.message}`);
  return data ?? [];
}

/**
 * 1면 머리기사.
 * 가장 최근에 퍼온 것 중 GitHub Trending 1위 성격의 항목(별 수가 가장 많은 것)을
 * 고르고, 없으면 그날 첫 항목을 쓴다.
 */
export async function getLeadTrendItem(): Promise<TrendItemRow | null> {
  const recent = await getTrendItems({ limit: 40 });
  if (recent.length === 0) return null;

  const newestDate = recent[0].collected_date;
  const sameDay = recent.filter((r) => r.collected_date === newestDate);

  const github = sameDay
    .filter((r) => r.source === "github")
    .sort(
      (a, b) =>
        Number(b.metrics?.stars_in_period ?? b.metrics?.stars ?? 0) -
        Number(a.metrics?.stars_in_period ?? a.metrics?.stars ?? 0),
    );

  return github[0] ?? sameDay[0];
}

export async function getTrendItem(sourceUrl: string): Promise<TrendItemRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("trend_items")
    .select("*")
    .eq("source_url", sourceUrl)
    .maybeSingle<TrendItemRow>();

  if (error) throw new Error(`트렌드 항목 조회 실패: ${error.message}`);
  return data;
}

/** /articles/trend/<public_id> 라우트용 조회 */
export async function getTrendItemByPublicId(
  publicId: string,
): Promise<TrendItemRow | null> {
  const { data, error } = await supabaseAdmin()
    .from("trend_items")
    .select("*")
    .eq("public_id", publicId)
    .maybeSingle<TrendItemRow>();

  if (error) throw new Error(`트렌드 항목 조회 실패: ${error.message}`);
  return data;
}

export async function countTrendToday(): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("trend_items")
    .select("source_url", { count: "exact", head: true })
    .eq("collected_date", kstDateString());

  if (error) return 0;
  return count ?? 0;
}

/** 출처별 전체 건수 — 1면 3열의 "N건 중 M건" 표기용 */
export async function countTrendBySource(date?: string): Promise<Record<string, number>> {
  let q = supabaseAdmin().from("trend_items").select("source").eq("status", "published");
  if (date) q = q.eq("collected_date", date);

  const { data, error } = await q.returns<{ source: TrendSource }[]>();
  if (error || !data) return {};

  return data.reduce<Record<string, number>>((acc, r) => {
    acc[r.source] = (acc[r.source] ?? 0) + 1;
    return acc;
  }, {});
}
