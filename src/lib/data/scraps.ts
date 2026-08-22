import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import type { GeekNewsRow, ScrapTargetType, TrendItemRow } from "@/types/db";

/**
 * 보관함 (scraps 테이블) 조회.
 *
 * 사용자가 "나중에 다시 읽을" 게시물을 담아 두는 곳이다. 목록은 언제나
 * member_id 로 걸러 읽으므로 다른 사람이 무엇을 담았는지는 화면에 나오지 않고,
 * 관리자 화면만 (target_type, target_key) 로 묶은 집계를 본다.
 *
 * 대상이 세 테이블에 흩어져 있어 (target_type, target_key) 조합으로 참조한다.
 * 지금 화면에 보관 버튼이 붙은 것은 자동 수집 두 카테고리(긱뉴스 · 트렌드 브리핑)다.
 */

// ---------------------------------------------------------------------------
// 대상 종류
// ---------------------------------------------------------------------------

export const SAVABLE_TYPES = ["geek", "trend"] as const;
export type SavableType = (typeof SAVABLE_TYPES)[number];

export function isSavableType(v: string): v is SavableType {
  return (SAVABLE_TYPES as readonly string[]).includes(v);
}

/** 트렌드 브리핑 카드에 필요한 컬럼만 — body(jsonb) 는 목록에서 쓰지 않는다. */
export type TrendCard = Pick<
  TrendItemRow,
  | "source_url"
  | "public_id"
  | "source"
  | "source_variant"
  | "title"
  | "deck"
  | "tags"
  | "collected_date"
  | "llm_provider"
  | "status"
>;

const TREND_CARD_COLS =
  "source_url, public_id, source, source_variant, title, deck, tags, collected_date, llm_provider, status";

export type GeekCard = Pick<
  GeekNewsRow,
  | "url"
  | "title"
  | "summary"
  | "published_at"
  | "source_domain"
  | "points"
  | "comment_count"
  | "external_url"
  | "is_hidden"
>;

const GEEK_CARD_COLS =
  "url, title, summary, published_at, source_domain, points, comment_count, external_url, is_hidden";

/** 보관된 항목 1건 — 원본이 지워졌거나 숨겨졌으면 geek/trend 가 모두 null 이다. */
export interface SavedEntry {
  targetType: ScrapTargetType;
  targetKey: string;
  savedAt: string;
  geek: GeekCard | null;
  trend: TrendCard | null;
}

interface ScrapRefRow {
  member_id: string;
  target_type: ScrapTargetType;
  target_key: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// 사용자별 조회
// ---------------------------------------------------------------------------

/**
 * 지금 그리는 목록 중 이 사용자가 이미 보관한 키만 골라 온다.
 *
 * 보관함 전체를 받아 오지 않고 화면에 있는 키만 물어보므로, 보관 건수가 늘어도
 * 쿼리가 화면 크기 이상으로 커지지 않는다.
 */
export async function getSavedKeys(
  memberId: string,
  type: SavableType,
  keys: string[],
): Promise<Set<string>> {
  const saved = new Set<string>();
  if (keys.length === 0) return saved;

  const db = supabaseAdmin();
  const unique = [...new Set(keys)];

  // URL 이 길어 in() 에 한 번에 다 넣으면 요청이 커진다 (수집 스크립트와 같은 이유).
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await db
      .from("scraps")
      .select("target_key")
      .eq("member_id", memberId)
      .eq("target_type", type)
      .in("target_key", unique.slice(i, i + 100))
      .returns<{ target_key: string }[]>();

    // 보관 표시는 부가 정보다. 실패해도 목록 자체는 그린다.
    if (error) return saved;
    for (const r of data ?? []) saved.add(r.target_key);
  }

  return saved;
}

export async function isSaved(
  memberId: string,
  type: SavableType,
  key: string,
): Promise<boolean> {
  const keys = await getSavedKeys(memberId, type, [key]);
  return keys.has(key);
}

/** 내 보관함 — 최근 담은 것부터. */
export async function getMyScraps(
  memberId: string,
  opts: { type?: SavableType; limit?: number } = {},
): Promise<SavedEntry[]> {
  const db = supabaseAdmin();

  let q = db
    .from("scraps")
    .select("member_id, target_type, target_key, created_at")
    .eq("member_id", memberId)
    .order("created_at", { ascending: false })
    .limit(opts.limit ?? 100);

  if (opts.type) q = q.eq("target_type", opts.type);

  const { data, error } = await q.returns<ScrapRefRow[]>();
  if (error) throw new Error(`보관함 조회 실패: ${error.message}`);

  const rows = data ?? [];
  const resolved = await resolveTargets(rows);

  return rows.map((r) => ({
    targetType: r.target_type,
    targetKey: r.target_key,
    savedAt: r.created_at,
    geek: r.target_type === "geek" ? resolved.geek.get(r.target_key) ?? null : null,
    trend: r.target_type === "trend" ? resolved.trend.get(r.target_key) ?? null : null,
  }));
}

/** 보관함 탭에 쓰는 종류별 건수. */
export async function countMyScraps(
  memberId: string,
): Promise<{ total: number; geek: number; trend: number }> {
  const db = supabaseAdmin();

  const entries = await Promise.all(
    SAVABLE_TYPES.map(async (type) => {
      const { count } = await db
        .from("scraps")
        .select("target_key", { count: "exact", head: true })
        .eq("member_id", memberId)
        .eq("target_type", type);
      return [type, count ?? 0] as const;
    }),
  );

  const byType = Object.fromEntries(entries) as Record<SavableType, number>;
  return { total: byType.geek + byType.trend, geek: byType.geek, trend: byType.trend };
}

// ---------------------------------------------------------------------------
// 관리자 집계
// ---------------------------------------------------------------------------

/** 한 번에 집계할 최대 행수. 사내 규모에서는 닿지 않지만 안전장치로 둔다. */
const STATS_MAX_ROWS = 20000;
const PAGE_SIZE = 1000;

export interface ScrapRankRow {
  targetType: ScrapTargetType;
  targetKey: string;
  /** 이 게시물을 보관한 사람 수 — PK 가 (member_id, type, key) 라 중복이 없다 */
  saves: number;
  lastSavedAt: string;
  geek: GeekCard | null;
  trend: TrendCard | null;
}

export interface ScrapStats {
  /** 보관 행 총합 */
  totalSaves: number;
  /** 한 번 이상 보관된 게시물 수 */
  savedItems: number;
  /** 보관 기능을 쓴 사람 수 */
  savers: number;
  /** 최근 7일 동안 담긴 건수 */
  recentSaves: number;
  byType: Record<ScrapTargetType, number>;
  ranking: ScrapRankRow[];
  /** 집계 상한(STATS_MAX_ROWS)에 걸려 일부만 센 경우 */
  truncated: boolean;
}

/**
 * 어떤 게시물이 많이 보관됐는지 집계한다.
 *
 * 집계 SQL 함수를 따로 두지 않고 행을 읽어 세는 이유는, scraps 테이블이
 * 0004_unit.sql 에 이미 있어서 추가 마이그레이션(인덱스뿐)을 적용하지 않은
 * 프로젝트에서도 화면이 그대로 동작하게 하려는 것이다.
 */
export async function getScrapStats(rankingLimit = 20): Promise<ScrapStats> {
  const db = supabaseAdmin();

  const rows: ScrapRefRow[] = [];
  let truncated = false;

  // PK 순으로 페이지를 넘긴다 (집계 중 새 행이 끼어도 순서가 흔들리지 않는다).
  for (let from = 0; from < STATS_MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("scraps")
      .select("member_id, target_type, target_key, created_at")
      .order("target_type")
      .order("target_key")
      .order("member_id")
      .range(from, from + PAGE_SIZE - 1)
      .returns<ScrapRefRow[]>();

    if (error) throw new Error(`보관 통계 조회 실패: ${error.message}`);

    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    if (from + PAGE_SIZE >= STATS_MAX_ROWS) truncated = true;
  }

  const byType: Record<ScrapTargetType, number> = { geek: 0, trend: 0, article: 0 };
  const savers = new Set<string>();
  const buckets = new Map<
    string,
    { targetType: ScrapTargetType; targetKey: string; saves: number; lastSavedAt: string }
  >();

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  let recentSaves = 0;

  for (const r of rows) {
    byType[r.target_type] = (byType[r.target_type] ?? 0) + 1;
    savers.add(r.member_id);
    if (new Date(r.created_at).getTime() >= weekAgo) recentSaves++;

    const id = `${r.target_type} ${r.target_key}`;
    const bucket = buckets.get(id);
    if (bucket) {
      bucket.saves++;
      if (r.created_at > bucket.lastSavedAt) bucket.lastSavedAt = r.created_at;
    } else {
      buckets.set(id, {
        targetType: r.target_type,
        targetKey: r.target_key,
        saves: 1,
        lastSavedAt: r.created_at,
      });
    }
  }

  const top = [...buckets.values()]
    .sort((a, b) => b.saves - a.saves || b.lastSavedAt.localeCompare(a.lastSavedAt))
    .slice(0, rankingLimit);

  const resolved = await resolveTargets(
    top.map((t) => ({ target_type: t.targetType, target_key: t.targetKey })),
  );

  return {
    totalSaves: rows.length,
    savedItems: buckets.size,
    savers: savers.size,
    recentSaves,
    byType,
    truncated,
    ranking: top.map((t) => ({
      ...t,
      geek: t.targetType === "geek" ? resolved.geek.get(t.targetKey) ?? null : null,
      trend: t.targetType === "trend" ? resolved.trend.get(t.targetKey) ?? null : null,
    })),
  };
}

// ---------------------------------------------------------------------------
// 대상 본문 채우기
// ---------------------------------------------------------------------------

/** (target_type, target_key) 목록을 원본 행으로 한 번에 채운다. */
async function resolveTargets(
  refs: { target_type: ScrapTargetType; target_key: string }[],
): Promise<{ geek: Map<string, GeekCard>; trend: Map<string, TrendCard> }> {
  const db = supabaseAdmin();

  const geekKeys = [
    ...new Set(refs.filter((r) => r.target_type === "geek").map((r) => r.target_key)),
  ];
  const trendKeys = [
    ...new Set(refs.filter((r) => r.target_type === "trend").map((r) => r.target_key)),
  ];

  const geek = new Map<string, GeekCard>();
  const trend = new Map<string, TrendCard>();

  await Promise.all([
    ...chunk(geekKeys, 100).map(async (keys) => {
      const { data } = await db
        .from("geek_news")
        .select(GEEK_CARD_COLS)
        .in("url", keys)
        .returns<GeekCard[]>();
      for (const g of data ?? []) if (!g.is_hidden) geek.set(g.url, g);
    }),
    ...chunk(trendKeys, 100).map(async (keys) => {
      const { data } = await db
        .from("trend_items")
        .select(TREND_CARD_COLS)
        .in("source_url", keys)
        .returns<TrendCard[]>();
      for (const t of data ?? []) if (t.status !== "hidden") trend.set(t.source_url, t);
    }),
  ]);

  return { geek, trend };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
