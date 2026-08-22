import Link from "next/link";
import type { Metadata } from "next";
import PipelinePanel from "@/components/admin/PipelinePanel";
import s from "@/components/admin/admin.module.css";
import { SECTION_MAP } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { comma, dashDate, hhmm, kstDateString, longDateKo } from "@/lib/format";
import { llmEnv } from "@/lib/env";
import {
  countArticles,
  countGeekNewsToday,
  countTrendBySource,
  getArticles,
  getTrendItems,
} from "@/lib/data/content";
import { getLastSyncRun } from "@/lib/data/ops";
import { supabaseAdmin } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "콘텐츠 운영" };

const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  published: { label: "발행됨", bg: "var(--green-50)", fg: "var(--green-700)" },
  review: { label: "검수 대기", bg: "var(--yellow-50)", fg: "var(--yellow-800)" },
  draft: { label: "초안", bg: "var(--gray-100)", fg: "var(--gray-700)" },
};

/** 이번 주 월요일(KST) */
function weekStartIso(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const dow = kst.getUTCDay(); // 0=일
  const back = dow === 0 ? 6 : dow - 1;
  const monday = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate() - back,
  ) - 9 * 3600_000;
  return new Date(monday).toISOString();
}

export default async function AdminDashboardPage() {
  const today = kstDateString();

  const [
    geekToday,
    trendTotals,
    pendingCount,
    weekArticles,
    lastTrendRun,
    lastGeekRun,
    recentArticles,
    recentTrend,
    viewsAgg,
  ] = await Promise.all([
    countGeekNewsToday(),
    countTrendBySource(today),
    countArticles({ status: "draft" }),
    countArticles({ status: "published", since: weekStartIso() }),
    getLastSyncRun("trend"),
    getLastSyncRun("geeknews"),
    getArticles({ limit: 5, includeDrafts: true }),
    getTrendItems({ limit: 5 }),
    totalViews(),
  ]);

  const trendToday = Object.values(trendTotals).reduce((a, b) => a + b, 0);
  const collectedToday = geekToday + trendToday;

  const stats = [
    {
      label: "오늘 수집 항목",
      value: comma(collectedToday),
      unit: "건",
      delta: `긱뉴스 ${geekToday} · 트렌드 ${trendToday}`,
      fg: collectedToday > 0 ? "var(--green-700)" : "var(--gray-500)",
    },
    {
      label: "발행 대기 초안",
      value: comma(pendingCount),
      unit: "건",
      delta: pendingCount > 0 ? "검수 필요" : "대기 없음",
      fg: pendingCount > 0 ? "var(--yellow-800)" : "var(--gray-500)",
    },
    {
      label: "이번 주 유닛 기고",
      value: comma(weekArticles),
      unit: "건",
      delta: weekArticles >= 4 ? "전원 제출 완료" : `목표 4건 중 ${weekArticles}건`,
      fg: weekArticles >= 4 ? "var(--green-700)" : "var(--gray-500)",
    },
    {
      label: "부서 조회수",
      value: comma(viewsAgg),
      unit: "회",
      delta: "누적",
      fg: "var(--gray-500)",
    },
  ];

  const sourceStats = [
    {
      kind: "gh" as const,
      count: `저장소 ${trendTotals.github ?? 0}건`,
      note: "daily · weekly · monthly 합집합",
      last: lastTrendRun?.finished_at ? hhmm(lastTrendRun.finished_at) : "—",
    },
    {
      kind: "hn" as const,
      count: `스레드 ${trendTotals.hn ?? 0}건`,
      note: "점수 기준 선별 · 상위 댓글 요약",
      last: lastTrendRun?.finished_at ? hhmm(lastTrendRun.finished_at) : "—",
    },
    {
      kind: "ax" as const,
      count: `논문 ${trendTotals.arxiv ?? 0}건`,
      note: "cs.AI · cs.CL · cs.IR · cs.LG",
      last: lastTrendRun?.finished_at ? hhmm(lastTrendRun.finished_at) : "—",
    },
  ];

  // 최근 게시물 표 — 유닛 기고와 자동 요약을 섞어 보여준다.
  const rows = [
    ...recentArticles.map((a) => ({
      key: a.id,
      href: routes.article(a),
      title: a.title,
      section: SECTION_MAP[a.section].ko,
      author: a.author?.name ?? "미지정",
      date: a.published_at ?? a.created_at,
      status: a.status,
    })),
    ...recentTrend.map((t) => ({
      key: t.source_url,
      href: routes.trend(t),
      title: t.title,
      section: SECTION_MAP.trend.ko,
      author: "자동 요약",
      date: t.collected_at,
      status: t.status === "published" ? "published" : "review",
    })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 8);

  return (
    <>
      <div className={s.pageHead}>
        <div>
          <div className={s.pageTitle}>콘텐츠 운영</div>
          <div className={s.pageSub}>
            {longDateKo(new Date())} · 발행 대기 초안 {pendingCount}건
            {lastGeekRun?.finished_at
              ? ` · 긱뉴스 최근 동기화 ${hhmm(lastGeekRun.finished_at)}`
              : ""}
          </div>
        </div>
        <Link href={routes.home} className={s.ghostBtn}>
          사이트 보기
        </Link>
      </div>

      <div className={s.statGrid}>
        {stats.map((st) => (
          <div key={st.label} className={s.statCard}>
            <div className={s.statLabel}>{st.label}</div>
            <div className={s.statValueRow}>
              <span className={s.statValue}>{st.value}</span>
              <span className={s.statUnit}>{st.unit}</span>
            </div>
            <div className={s.statDelta} style={{ color: st.fg }}>
              {st.delta}
            </div>
          </div>
        ))}
      </div>

      <PipelinePanel
        initialRun={lastTrendRun ?? lastGeekRun}
        sourceStats={sourceStats}
        llmLabel={`${llmEnv.provider} / ${
          llmEnv.provider === "openai"
            ? process.env.OPENAI_MODEL ?? "gpt-5-mini"
            : process.env.GEMINI_MODEL ?? "gemini-2.5-flash"
        }`}
      />

      <div className={s.panel}>
        <div className={s.panelHead}>
          <div>
            <div className={s.panelTitle}>게시물 등록</div>
            <div className={s.panelDesc}>
              유닛원이 직접 쓰는 두 개의 카테고리입니다. 긱뉴스·트렌드 브리핑은 위
              파이프라인이 자동으로 채웁니다.
            </div>
          </div>
          <Link href={routes.sectionWrite("review")} className={s.primaryBtn}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            새 글 작성
          </Link>
        </div>

        <div className={s.composeGrid}>
          <Link href={routes.sectionWrite("review")} className={s.composeCard}>
            <div className={s.composeHead}>
              <span className={s.composeBadge}>위클리 리뷰</span>
              <span className={s.composeMeta}>이번 주 {weekArticles}건 제출</span>
            </div>
            <div className={s.composeTitle}>
              한 주에 한 편, 고른 저장소·스레드·논문 리뷰
            </div>
            <div className={s.composeDesc}>
              제목·부제·본문 블록·원문 링크만 채우면 됩니다. 첨부는 없습니다.
            </div>
          </Link>

          <Link href={routes.sectionWrite("deep")} className={s.composeCard}>
            <div className={s.composeHead}>
              <span className={`${s.composeBadge} ${s.composeBadgeDeep}`}>심층 분석</span>
              <span className={s.composeMeta}>월 1회</span>
            </div>
            <div className={s.composeTitle}>
              월 1회 발표 원고 · 발표 사진과 자료 포함
            </div>
            <div className={s.composeDesc}>
              발표 일시·장소, 현장 사진, 발표 자료(분할 암호화 업로드)를 함께 등록합니다.
            </div>
          </Link>
        </div>
      </div>

      <div className={s.tableCard}>
        <div className={s.tableTitle}>최근 게시물</div>
        <div className={s.tableHead}>
          <div>제목</div>
          <div>카테고리</div>
          <div>작성자</div>
          <div>발행일</div>
          <div>상태</div>
        </div>

        {rows.length === 0 ? (
          <div className={s.tableEmpty}>
            아직 게시물이 없습니다. 파이프라인을 실행하거나 새 글을 작성해 보세요.
          </div>
        ) : (
          rows.map((r) => {
            const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.draft;
            return (
              <Link key={r.key} href={r.href} className={s.tableRow}>
                <div className={s.cellTitle}>{r.title}</div>
                <div className={s.cellMuted}>{r.section}</div>
                <div className={s.cellMuted}>{r.author}</div>
                <div className={s.cellMono}>{dashDate(r.date)}</div>
                <div>
                  <span
                    className={s.statusPill}
                    style={{ background: st.bg, color: st.fg }}
                  >
                    {st.label}
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </>
  );
}

/** articles.view_count + trend_items.view_count 합계 */
async function totalViews(): Promise<number> {
  const db = supabaseAdmin();
  const [a, t] = await Promise.all([
    db.from("articles").select("view_count").returns<{ view_count: number }[]>(),
    db.from("trend_items").select("view_count").returns<{ view_count: number }[]>(),
  ]);
  const sum = (rows: { view_count: number }[] | null) =>
    (rows ?? []).reduce((acc, r) => acc + (r.view_count ?? 0), 0);
  return sum(a.data) + sum(t.data);
}
