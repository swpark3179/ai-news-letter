import "server-only";

import { supabaseAdmin } from "@/lib/supabase/server";
import { kstDateString } from "@/lib/format";
import type {
  ArticleFull,
  ArticleRow,
  ArticleSourceRow,
  ArticleWithAuthor,
  CommentRow,
  GeekNewsRow,
  MeetingRow,
  MemberRow,
  RotationRow,
  TrendItemRow,
  TrendSource,
  WritableSection,
} from "@/types/db";

/**
 * 화면이 쓰는 읽기 쿼리 모음.
 * 전부 서버에서 service_role 키로 실행된다 (RLS 우회).
 */

const AUTHOR_SELECT = "id, name, role, initial, avatar_tone";

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

// ---------------------------------------------------------------------------
// 기사 (위클리 리뷰 / 심층 분석)
// ---------------------------------------------------------------------------

export interface ArticleQuery {
  section?: WritableSection;
  limit?: number;
  includeDrafts?: boolean;
  /** 특정 작성자의 글만 — 섹션 화면의 "내 글" 필터용 */
  authorId?: string;
}

export async function getArticles(opts: ArticleQuery): Promise<ArticleWithAuthor[]> {
  let query = supabaseAdmin()
    .from("articles")
    .select(`*, author:members!articles_author_id_fkey(${AUTHOR_SELECT})`);

  // "내 글" 은 임시저장이 섞여 published_at 이 비므로 최근 손댄 순으로 본다.
  query = opts.authorId
    ? query.order("updated_at", { ascending: false })
    : query
        .order("published_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false });

  if (opts.section) query = query.eq("section", opts.section);
  if (opts.authorId) query = query.eq("author_id", opts.authorId);
  if (!opts.includeDrafts) query = query.eq("status", "published");
  if (opts.limit) query = query.limit(opts.limit);

  const { data, error } = await query.returns<ArticleWithAuthor[]>();
  if (error) throw new Error(`기사 조회 실패: ${error.message}`);
  return data ?? [];
}

export async function getLatestDeepArticle(): Promise<ArticleWithAuthor | null> {
  const rows = await getArticles({ section: "deep", limit: 1 });
  return rows[0] ?? null;
}

export async function getArticleFull(id: string): Promise<ArticleFull | null> {
  const db = supabaseAdmin();

  const { data: article, error } = await db
    .from("articles")
    .select(`*, author:members!articles_author_id_fkey(${AUTHOR_SELECT})`)
    .eq("id", id)
    .maybeSingle<ArticleWithAuthor>();

  if (error) throw new Error(`기사 조회 실패: ${error.message}`);
  if (!article) return null;

  const [sourcesRes, commentsRes] = await Promise.all([
    db
      .from("article_sources")
      .select("*")
      .eq("article_id", id)
      .order("seq")
      .returns<ArticleSourceRow[]>(),
    db
      .from("comments")
      .select("*")
      .eq("article_id", id)
      .eq("is_deleted", false)
      .order("created_at")
      .returns<CommentRow[]>(),
  ]);

  return {
    ...article,
    sources: sourcesRes.data ?? [],
    comments: commentsRes.data ?? [],
  };
}

/**
 * 이어쓸 임시저장 글 — 같은 섹션에서 가장 최근에 손댄 draft 1건.
 *
 * 글쓰기 화면에 다시 들어왔을 때 복원할 대상이다. 여러 개가 쌓여 있어도
 * 가장 최근 것만 이어쓰고, 나머지는 "내 글" 목록에서 볼 수 있다.
 */
export async function getMyDraft(
  authorId: string,
  section: WritableSection,
): Promise<ArticleFull | null> {
  const { data, error } = await supabaseAdmin()
    .from("articles")
    .select("id")
    .eq("author_id", authorId)
    .eq("section", section)
    .eq("status", "draft")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error || !data) return null;
  return getArticleFull(data.id);
}

export async function countComments(articleId: string): Promise<number> {
  const { count, error } = await supabaseAdmin()
    .from("comments")
    .select("id", { count: "exact", head: true })
    .eq("article_id", articleId)
    .eq("is_deleted", false);

  if (error) return 0;
  return count ?? 0;
}

export async function countArticles(opts: {
  section?: WritableSection;
  status?: ArticleRow["status"];
  since?: string;
}): Promise<number> {
  let q = supabaseAdmin().from("articles").select("id", { count: "exact", head: true });
  if (opts.section) q = q.eq("section", opts.section);
  if (opts.status) q = q.eq("status", opts.status);
  if (opts.since) q = q.gte("published_at", opts.since);

  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// 모임 · 로테이션 · 멤버
// ---------------------------------------------------------------------------

export interface MeetingWithPeople extends MeetingRow {
  presenter: Pick<MemberRow, "id" | "name" | "role" | "initial" | "avatar_tone"> | null;
  attendees: Pick<MemberRow, "id" | "name" | "initial" | "avatar_tone">[];
}

export async function getMeetings(limit = 12): Promise<MeetingWithPeople[]> {
  const db = supabaseAdmin();

  const { data: meetings, error } = await db
    .from("meetings")
    .select(`*, presenter:members!meetings_presenter_id_fkey(${AUTHOR_SELECT})`)
    .order("met_at", { ascending: false })
    .limit(limit)
    .returns<(MeetingRow & { presenter: MeetingWithPeople["presenter"] })[]>();

  if (error) throw new Error(`모임 조회 실패: ${error.message}`);
  if (!meetings?.length) return [];

  const { data: links } = await db
    .from("meeting_attendees")
    .select(`meeting_id, member:members!meeting_attendees_member_id_fkey(id, name, initial, avatar_tone)`)
    .in("meeting_id", meetings.map((m) => m.id))
    .returns<{ meeting_id: string; member: MeetingWithPeople["attendees"][number] }[]>();

  const byMeeting = new Map<string, MeetingWithPeople["attendees"]>();
  for (const l of links ?? []) {
    const arr = byMeeting.get(l.meeting_id) ?? [];
    if (l.member) arr.push(l.member);
    byMeeting.set(l.meeting_id, arr);
  }

  return meetings.map((m) => ({
    ...m,
    attendees: byMeeting.get(m.id) ?? [],
  }));
}

export interface RotationWithMember extends RotationRow {
  member: Pick<MemberRow, "id" | "name" | "role" | "initial" | "avatar_tone"> | null;
}

export async function getRotations(
  kind: "deep" | "weekly",
  limit = 8,
): Promise<RotationWithMember[]> {
  const { data, error } = await supabaseAdmin()
    .from("rotations")
    .select(`*, member:members!rotations_member_id_fkey(${AUTHOR_SELECT})`)
    .eq("kind", kind)
    .order("period_start", { ascending: kind === "deep" })
    .limit(limit)
    .returns<RotationWithMember[]>();

  if (error) throw new Error(`로테이션 조회 실패: ${error.message}`);
  return data ?? [];
}

export async function getUnitMembers(): Promise<MemberRow[]> {
  const { data, error } = await supabaseAdmin()
    .from("members")
    .select("*")
    .in("role", ["unit_lead", "member"])
    .eq("is_active", true)
    .order("role")
    .order("name")
    .returns<MemberRow[]>();

  if (error) throw new Error(`멤버 조회 실패: ${error.message}`);
  return data ?? [];
}
