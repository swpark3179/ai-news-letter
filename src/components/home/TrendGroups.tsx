import Link from "next/link";
import { SRC, TREND_GROUPS, TREND_SOURCE_TO_KIND } from "@/lib/domain";
import { routes } from "@/lib/routes";
import type { TrendItemRow, TrendSource } from "@/types/db";
import s from "./home.module.css";

interface Props {
  /** 머리기사를 제외한 오늘의 트렌드 항목 */
  items: TrendItemRow[];
  /** 출처별 전체 수집 건수 (요약 대비 표기용) */
  totals: Record<string, number>;
  /** 오늘 수집한 원문 총 건수 */
  fetchedTotal: number;
}

const PER_GROUP = 3;

/** 메타 문구 — GitHub 은 별, HN 은 댓글, arXiv 는 논문 번호 */
function metaOf(item: TrendItemRow): string {
  const m = item.metrics ?? {};
  switch (item.source) {
    case "github": {
      const stars = m.stars_in_period ?? m.stars;
      const period =
        item.source_variant === "weekly"
          ? "this week"
          : item.source_variant === "monthly"
            ? "this month"
            : "today";
      return stars ? `★ ${Number(stars).toLocaleString("ko-KR")} ${period}` : "GitHub";
    }
    case "hn":
      return m.comments ? `${m.comments} comments` : "Hacker News";
    case "arxiv":
      return m.arxiv_id ? `arXiv:${m.arxiv_id}` : "arXiv";
    case "geeknews":
      return m.points ? `${m.points} points` : "긱뉴스";
  }
}

function groupLabel(source: TrendSource): string {
  return SRC[TREND_SOURCE_TO_KIND[source]].label;
}

/** "오늘 요약된 게시물" 3열 (디자인 232~258행) */
export default function TrendGroups({ items, totals, fetchedTotal }: Props) {
  const summarized = items.length + 1; // 머리기사 포함

  return (
    <div className={s.todayBlock}>
      <div className={s.todayHead}>
        <span className={s.todayTitle}>오늘 요약된 게시물</span>
        <span className={s.todayNote}>
          원문 {fetchedTotal.toLocaleString("ko-KR")}건을 수집해 {summarized}건을 개별
          게시물로 요약했습니다 (머리기사 1건 포함) · 제목을 누르면 요약 전문, 원문 링크는
          출처로 이동합니다
        </span>
      </div>

      <div className={s.groupGrid}>
        {TREND_GROUPS.map((source, gi) => {
          const all = items.filter((i) => i.source === source);
          const shown = all.slice(0, PER_GROUP);
          const rest = (totals[source] ?? all.length) - shown.length;
          const style = SRC[TREND_SOURCE_TO_KIND[source]];
          const label = groupLabel(source);

          return (
            <div
              key={source}
              className={`${s.group} ${gi === 0 ? s.groupFirst : ""}`}
            >
              <div className={s.groupHead}>
                <span
                  className={s.groupTag}
                  style={{ background: style.bg, color: style.fg }}
                >
                  {style.tag}
                </span>
                <span className={s.groupNote}>
                  {totals[source] ? `${totals[source]}건 중 ${shown.length}건` : "수집 대기"}
                </span>
              </div>

              {shown.length === 0 && (
                <div className={s.groupEmpty}>아직 수집된 항목이 없습니다.</div>
              )}

              {shown.map((item) => (
                <div key={item.source_url} className={s.groupItem}>
                  <Link href={routes.trend(item)} className={s.groupItemTitle}>
                    {item.title}
                  </Link>
                  {item.deck && <div className={s.groupItemDeck}>{item.deck}</div>}
                  <div className={s.groupItemMeta}>
                    <span className={s.metaMono}>{metaOf(item)}</span>
                    <a
                      href={item.source_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={s.originLink}
                    >
                      원문 ↗
                    </a>
                  </div>
                </div>
              ))}

              <Link href={routes.section("trend", source)} className={s.groupMore}>
                {rest > 0 ? `${label} ${rest}건 더보기 →` : `${label} 전체 보기 →`}
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
