import "server-only";

import { CATEGORIES } from "@/lib/domain";
import { addDays } from "@/lib/format";
import { supabaseRead } from "@/lib/supabase/read";
import type { CategoryKey } from "@/types/db";
import type { FeedItem, HadaContent, IssueRow, TrendDetail } from "@/types/feed";

/**
 * 화면이 쓰는 읽기 쿼리 모음. 전부 anon 키로 모바일 뷰를 읽는다 (lib/supabase/read.ts).
 *
 * 열은 고른다 — search_text 는 검색 조건에만 쓰고 목록마다 실어 나를 이유가 없다.
 *
 * 웹은 「날」 단위로 읽는다. 앱은 피드를 시간 역순으로 끝없이 내리지만, 웹은 어제 무엇을
 * 읽었는지 기억해 주지 않으므로 수집한 날(collected_date)로 묶어 지면처럼 보여 준다.
 */

const FEED_COLUMNS =
  "type,key,source,repo,title,lede,meta,published_at,open_url,host,public_id,source_variant,collected_date,score,origin_url";

/** mobile_showcase 에는 트렌드 전용 열과 origin_url 이 없고, 대신 maker 가 있다 */
const SHOWCASE_COLUMNS =
  "type,key,title,lede,meta,published_at,open_url,host,maker,collected_date,score";

/** 한 번에 읽는 상한. 7일치가 가장 많은 긱뉴스도 150건 안팎이다. */
const WINDOW_LIMIT = 600;

/**
 * 카테고리 하나를 읽는 질의의 출발점 — 어느 뷰를 어떤 조건으로 읽는지가 여기 한 곳에 있다.
 *   geek          mobile_feed      type = geek
 *   show          mobile_showcase
 *   github·hn·arxiv mobile_feed    type = trend, source = 그 값
 */
function fromCategory(cat: CategoryKey, columns?: string, count?: "exact") {
  const db = supabaseRead();
  const opts = count ? { count } : undefined;

  if (cat === "show") {
    return db.from("mobile_showcase").select(columns ?? SHOWCASE_COLUMNS, opts);
  }
  const q = db.from("mobile_feed").select(columns ?? FEED_COLUMNS, opts);
  return cat === "geek" ? q.eq("type", "geek") : q.eq("type", "trend").eq("source", cat);
}

/** 두 뷰의 열 차이를 메워 한 모양으로 만든다 */
function toItem(r: Partial<FeedItem>): FeedItem {
  return {
    type: r.type ?? "geek",
    key: r.key ?? "",
    source: r.source ?? null,
    repo: r.repo ?? null,
    title: r.title ?? "",
    lede: r.lede ?? "",
    meta: r.meta ?? "",
    published_at: r.published_at ?? "",
    open_url: r.open_url ?? "",
    host: r.host ?? "",
    public_id: r.public_id ?? null,
    source_variant: r.source_variant ?? null,
    collected_date: r.collected_date ?? "",
    score: r.score ?? null,
    origin_url: r.origin_url ?? null,
    maker: r.maker ?? null,
  };
}

// ---------------------------------------------------------------------------
// 날짜
// ---------------------------------------------------------------------------

/** 그 카테고리를 마지막으로 수집한 날. before 를 주면 그보다 앞선 날 중 가장 늦은 날. */
export async function getLatestDate(
  cat: CategoryKey,
  before?: string,
): Promise<string | null> {
  let q = fromCategory(cat, "collected_date")
    .order("collected_date", { ascending: false })
    .limit(1);
  if (before) q = q.lt("collected_date", before);

  const { data, error } = await q.maybeSingle<{ collected_date: string }>();
  if (error) throw new Error(`수집일 조회 실패: ${error.message}`);
  return data?.collected_date ?? null;
}

// ---------------------------------------------------------------------------
// 목록
// ---------------------------------------------------------------------------

/**
 * 수집한 날 from ~ to (둘 다 포함). 늦은 날이 먼저 오고, 같은 날 안에서는 지표가 큰 것부터
 * (arXiv 는 지표가 없어 수집 순서대로). 같은 값이 겹쳐도 순서가 흔들리지 않게 key 를 끝에 둔다.
 */
export async function getCategoryWindow(
  cat: CategoryKey,
  from: string,
  to: string,
): Promise<FeedItem[]> {
  const { data, error } = await fromCategory(cat)
    .gte("collected_date", from)
    .lte("collected_date", to)
    .order("collected_date", { ascending: false })
    .order("score", { ascending: false, nullsFirst: false })
    .order("published_at", { ascending: false })
    .order("key", { ascending: false })
    .limit(WINDOW_LIMIT)
    .returns<Partial<FeedItem>[]>();

  if (error) throw new Error(`목록 조회 실패: ${error.message}`);
  return (data ?? []).map(toItem);
}

export function getCategoryDay(cat: CategoryKey, date: string): Promise<FeedItem[]> {
  return getCategoryWindow(cat, date, date);
}

/** 7일 창 — until 을 포함해 거꾸로 7일 */
export const WINDOW_DAYS = 7;

export function windowStart(until: string): string {
  return addDays(until, -(WINDOW_DAYS - 1));
}

// ---------------------------------------------------------------------------
// 검색 (search_text — 제목 · 요약 · 저장소 이름 · 태그를 이어 붙인 뷰의 열)
// ---------------------------------------------------------------------------

/**
 * 입력을 낱말로 나눠 **모두 들어 있는** 행을 찾는다 (낱말마다 ilike 를 AND 로 건다).
 *
 * 앱(SupabaseFeedRepository._likePattern)처럼 * % _ 는 걷어낸다 — 사용자가 친 기호가
 * 와일드카드로 동작하면 결과가 이유 없이 늘어난다. 역슬래시는 LIKE 의 이스케이프 문자라
 * 끝에 오면 질의가 실패하므로 같이 뺀다. 값은 PostgREST 가 파라미터로 넘겨 주입 위험은 없다.
 */
export function searchTerms(raw: string): string[] {
  return raw
    .replace(/[*%_\\]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean)
    .slice(0, 5);
}

export interface SearchResult {
  items: FeedItem[];
  total: number;
}

export async function searchCategory(
  cat: CategoryKey,
  raw: string,
  limit: number,
): Promise<SearchResult> {
  const terms = searchTerms(raw);
  if (terms.length === 0) return { items: [], total: 0 };

  let q = fromCategory(cat, undefined, "exact");
  for (const t of terms) q = q.ilike("search_text", `%${t}%`);

  const { data, error, count } = await q
    .order("collected_date", { ascending: false })
    .order("score", { ascending: false, nullsFirst: false })
    .order("published_at", { ascending: false })
    .order("key", { ascending: false })
    .limit(limit)
    .returns<Partial<FeedItem>[]>();

  if (error) throw new Error(`검색 실패: ${error.message}`);
  return { items: (data ?? []).map(toItem), total: count ?? data?.length ?? 0 };
}

/** 다섯 카테고리를 한꺼번에 — /search 화면 */
export async function searchAll(
  raw: string,
  perCategory: number,
): Promise<Record<CategoryKey, SearchResult>> {
  const results = await Promise.all(
    CATEGORIES.map((c) => searchCategory(c.key, raw, perCategory)),
  );
  return Object.fromEntries(
    CATEGORIES.map((c, i) => [c.key, results[i]]),
  ) as Record<CategoryKey, SearchResult>;
}

// ---------------------------------------------------------------------------
// 1면
// ---------------------------------------------------------------------------

export interface EditionSlot {
  /** 그 카테고리를 마지막으로 수집한 날. 하나도 없으면 null */
  date: string | null;
  items: FeedItem[];
}

export interface Edition {
  /** 다섯 카테고리 중 가장 늦은 수집일 — 지면의 날짜 */
  date: string | null;
  slots: Record<CategoryKey, EditionSlot>;
}

/**
 * 1면 — 카테고리마다 **마지막으로 수집한 날** 것을 전부 싣는다.
 *
 * 지면 하나의 날짜로 자르지 않는 이유: 수집은 07:00 부터 카테고리별로 차례로 돌고,
 * arXiv 는 주말에 새 논문이 없다. 한 날짜로 자르면 아침 몇 분, 또는 주말 내내 칸이 빈다.
 * 칸마다 날짜를 붙여 「오늘 것」인지 아닌지는 읽는 사람이 바로 알 수 있게 한다.
 */
export async function getEdition(): Promise<Edition> {
  const dates = await Promise.all(CATEGORIES.map((c) => getLatestDate(c.key)));
  const lists = await Promise.all(
    CATEGORIES.map((c, i) => (dates[i] ? getCategoryDay(c.key, dates[i]) : [])),
  );

  const slots = Object.fromEntries(
    CATEGORIES.map((c, i) => [c.key, { date: dates[i], items: lists[i] }]),
  ) as Record<CategoryKey, EditionSlot>;

  const known = dates.filter((d): d is string => d !== null).sort();
  return { date: known.at(-1) ?? null, slots };
}

/**
 * 1면 머리기사 — 그날 GitHub 에서 기간 별이 가장 많은 것. items 는 지표 순으로 와 있다
 * (getCategoryWindow 의 정렬).
 */
export function pickLead(github: FeedItem[]): FeedItem | null {
  return github[0] ?? null;
}

// ---------------------------------------------------------------------------
// 상세
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

/** 긱뉴스 · 쇼케이스 상세의 머리 — 목록 한 줄이 이미 제목 · 요약 · 지표를 갖고 있다 */
export async function getHadaItem(
  kind: "geek" | "show",
  key: string,
): Promise<FeedItem | null> {
  const { data, error } = await fromCategory(kind)
    .eq("key", key)
    .maybeSingle<Partial<FeedItem>>();

  if (error) throw new Error(`항목 조회 실패: ${error.message}`);
  return data ? toItem(data) : null;
}

/**
 * 본문. 뷰는 수집에 성공한 행만, 감추지 않은 항목만 낸다 — 없다는 것은 「아직 못 받았다」이고
 * 화면은 원문 링크로 넘긴다 (앱의 HadaDetailScreen 과 같은 동작).
 */
export async function getHadaContent(key: string): Promise<HadaContent | null> {
  const { data, error } = await supabaseRead()
    .from("mobile_hada_content")
    .select("key,source,body_md,truncated,fetched_at")
    .eq("key", key)
    .maybeSingle<HadaContent>();

  if (error) throw new Error(`본문 조회 실패: ${error.message}`);
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
