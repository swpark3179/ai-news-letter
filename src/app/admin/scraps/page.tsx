import Link from "next/link";
import type { Metadata } from "next";
import s from "@/components/admin/admin.module.css";
import { SRC, TREND_SOURCE_TO_KIND, sourceStyleOf } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { comma, dashDate } from "@/lib/format";
import { getScrapStats, type ScrapRankRow } from "@/lib/data/scraps";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "보관 통계" };

/** 표 열 폭 — 순위 · 제목 · 카테고리 · 보관 수 · 최근 보관 */
const COLS = "56px minmax(0, 1fr) 190px 90px 100px";

/**
 * 보관 통계.
 *
 * 어떤 게시물이 많이 담겼는지만 본다. 누가 무엇을 담았는지는 이 화면에 나오지
 * 않는다 (개인 보관함은 본인만 보는 /me 화면이다).
 */
export default async function AdminScrapsPage() {
  const stats = await getScrapStats(20);

  const cards = [
    {
      label: "총 보관 수",
      value: comma(stats.totalSaves),
      unit: "건",
      delta: `긱뉴스 ${stats.byType.geek} · 트렌드 ${stats.byType.trend}`,
      fg: stats.totalSaves > 0 ? "var(--purple-700)" : "var(--gray-500)",
    },
    {
      label: "보관된 게시물",
      value: comma(stats.savedItems),
      unit: "건",
      delta: "한 번 이상 담긴 게시물",
      fg: "var(--gray-500)",
    },
    {
      label: "보관한 사용자",
      value: comma(stats.savers),
      unit: "명",
      delta: "보관 기능을 쓴 사람",
      fg: "var(--gray-500)",
    },
    {
      label: "최근 7일 보관",
      value: comma(stats.recentSaves),
      unit: "건",
      delta: stats.recentSaves > 0 ? "이번 주 담긴 건수" : "이번 주 없음",
      fg: stats.recentSaves > 0 ? "var(--green-700)" : "var(--gray-500)",
    },
  ];

  return (
    <>
      <div className={s.pageHead}>
        <div>
          <div className={s.pageTitle}>보관 통계</div>
          <div className={s.pageSub}>
            구독자가 나중에 다시 읽으려고 담아 둔 게시물 집계입니다. 누가 담았는지는
            표시하지 않고, 어떤 게시물이 많이 담겼는지만 봅니다.
          </div>
        </div>
        <Link href={routes.section("trend")} className={s.ghostBtn}>
          트렌드 브리핑 보기
        </Link>
      </div>

      <div className={s.statGrid}>
        {cards.map((c) => (
          <div key={c.label} className={s.statCard}>
            <div className={s.statLabel}>{c.label}</div>
            <div className={s.statValueRow}>
              <span className={s.statValue}>{c.value}</span>
              <span className={s.statUnit}>{c.unit}</span>
            </div>
            <div className={s.statDelta} style={{ color: c.fg }}>
              {c.delta}
            </div>
          </div>
        ))}
      </div>

      <div className={s.tableCard}>
        <div className={s.tableTitle}>많이 보관된 게시물 상위 {stats.ranking.length}건</div>
        <div className={s.tableHead} style={{ gridTemplateColumns: COLS }}>
          <div>순위</div>
          <div>제목</div>
          <div>카테고리</div>
          <div>보관 수</div>
          <div>최근 보관</div>
        </div>

        {stats.ranking.length === 0 ? (
          <div className={s.tableEmpty}>
            아직 보관된 게시물이 없습니다. 긱뉴스·트렌드 브리핑 목록의 보관 버튼을 누르면
            집계가 시작됩니다.
          </div>
        ) : (
          stats.ranking.map((r, i) => <RankRow key={`${r.targetType} ${r.targetKey}`} rank={i + 1} row={r} />)
        )}

        {stats.truncated && (
          <div className={s.tableEmpty}>
            보관 기록이 많아 최근 일부만 집계했습니다. 정확한 전체 집계가 필요하면
            Supabase 에서 scraps 테이블을 직접 조회하세요.
          </div>
        )}
      </div>
    </>
  );
}

function RankRow({ rank, row }: { rank: number; row: ScrapRankRow }) {
  const view = row.geek
    ? {
        title: row.geek.title,
        category: SRC.gk.label,
        badge: SRC.gk,
        href: row.geek.url,
        external: true,
      }
    : row.trend
      ? {
          title: row.trend.title,
          category: `트렌드 브리핑 · ${SRC[TREND_SOURCE_TO_KIND[row.trend.source]].label}`,
          badge: sourceStyleOf(row.trend.source),
          href: routes.trend(row.trend),
          external: false,
        }
      : null;

  const inner = (
    <>
      <div className={s.cellMono}>{rank}</div>
      <div className={s.cellTitle}>
        {view ? view.title : "지워졌거나 숨겨진 게시물"}
      </div>
      <div className={s.cellMuted}>
        {view ? (
          <span
            className={s.statusPill}
            style={{ background: view.badge.bg, color: view.badge.fg }}
          >
            {view.category}
          </span>
        ) : (
          row.targetType
        )}
      </div>
      <div className={s.cellMono}>{row.saves}</div>
      <div className={s.cellMono}>{dashDate(row.lastSavedAt)}</div>
    </>
  );

  if (!view) {
    return (
      <div className={s.tableRow} style={{ gridTemplateColumns: COLS }} title={row.targetKey}>
        {inner}
      </div>
    );
  }

  return view.external ? (
    <a
      href={view.href}
      target="_blank"
      rel="noreferrer noopener"
      className={s.tableRow}
      style={{ gridTemplateColumns: COLS }}
    >
      {inner}
    </a>
  ) : (
    <Link href={view.href} className={s.tableRow} style={{ gridTemplateColumns: COLS }}>
      {inner}
    </Link>
  );
}
