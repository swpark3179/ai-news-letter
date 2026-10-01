import Link from "next/link";
import { SRC, TREND_GROUPS, TREND_SOURCE_TO_KIND } from "@/lib/domain";
import { shortDateKo, shortDot } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { TrendSource } from "@/types/db";
import type { FeedItem } from "@/types/feed";
import s from "./home.module.css";

interface Props {
  /** 머리기사를 제외한 그날의 트렌드 항목 */
  items: FeedItem[];
  /** 출처별 그날 건수 (머리기사 포함) */
  totals: Record<string, number>;
  /** 3열에 걸린 항목의 수집 날짜 (YYYY-MM-DD) */
  collectedDate?: string;
}

const PER_GROUP = 3;

function groupLabel(source: TrendSource): string {
  return SRC[TREND_SOURCE_TO_KIND[source]].label;
}

/** "오늘 요약된 게시물" 3열 (디자인 232~258행) */
export default function TrendGroups({
  items,
  totals,
  collectedDate,
}: Props) {
  const summarized = items.length + 1; // 머리기사 포함

  return (
    <div className={s.todayBlock}>
      <div className={s.todayHead}>
        <span className={s.todayTitle}>오늘 요약된 게시물</span>
        {collectedDate && (
          <span className={s.todayDate}>{shortDateKo(collectedDate)} 수집</span>
        )}
        <span className={s.todayNote}>{summarized}건 요약 (머리기사 포함)</span>
      </div>

      <div className={s.groupGrid}>
        {TREND_GROUPS.map((source, gi) => {
          // 같은 출처 안에서는 지표가 큰 것부터 — arXiv 는 지표가 없어 수집 순서대로 남는다.
          const all = items
            .filter((i) => i.source === source)
            .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
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

              {shown.map((item) => {
                // 저장소 이름이 있으면 그것이 제목이고 AI 제목이 설명으로 내려간다.
                // 어느 쪽이든 좁은 열에서 글덩어리가 되지 않게 텍스트 블록은 최대 두 개다.
                const repo = item.repo;
                const lede = repo ? item.title : item.lede;

                return (
                  <div key={item.key} className={s.groupItem}>
                    <Link
                      href={routes.trend(item)}
                      className={repo ? s.groupItemRepo : s.groupItemTitle}
                    >
                      {repo ?? item.title}
                    </Link>
                    {lede && <div className={s.groupItemLede}>{lede}</div>}
                    <div className={s.groupItemMeta}>
                      <span className={s.metaDate}>{shortDot(item.collected_date)}</span>
                      {item.meta && <span className={s.metaMono}>{item.meta}</span>}
                      <a
                        href={item.open_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={s.originLink}
                      >
                        원문 ↗
                      </a>
                    </div>
                  </div>
                );
              })}

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
