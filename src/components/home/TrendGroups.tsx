import Link from "next/link";
import ScrapButton from "@/components/scrap/ScrapButton";
import { SRC, TREND_GROUPS, TREND_SOURCE_TO_KIND } from "@/lib/domain";
import { shortDateKo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { collectedLabelOf, metaTextOf, repoLabelOf } from "@/lib/trendItem";
import type { TrendItemRow, TrendSource } from "@/types/db";
import s from "./home.module.css";

interface Props {
  /** 머리기사를 제외한 오늘의 트렌드 항목 */
  items: TrendItemRow[];
  /** 출처별 전체 수집 건수 (요약 대비 표기용) */
  totals: Record<string, number>;
  /** 오늘 수집한 원문 총 건수 */
  fetchedTotal: number;
  /** 3열에 걸린 항목의 수집 날짜 (YYYY-MM-DD) */
  collectedDate?: string;
  /** 로그인 사용자에게만 보관 버튼을 붙인다 */
  canSave?: boolean;
  /** 이미 보관한 trend_items.source_url 집합 */
  saved?: Set<string>;
}

const PER_GROUP = 3;

function groupLabel(source: TrendSource): string {
  return SRC[TREND_SOURCE_TO_KIND[source]].label;
}

/** "오늘 요약된 게시물" 3열 (디자인 232~258행) */
export default function TrendGroups({
  items,
  totals,
  fetchedTotal,
  collectedDate,
  canSave = false,
  saved,
}: Props) {
  const summarized = items.length + 1; // 머리기사 포함

  return (
    <div className={s.todayBlock}>
      <div className={s.todayHead}>
        <span className={s.todayTitle}>오늘 요약된 게시물</span>
        {collectedDate && (
          <span className={s.todayDate}>{shortDateKo(collectedDate)} 수집</span>
        )}
        <span className={s.todayNote}>
          원문 {fetchedTotal.toLocaleString("ko-KR")}건 중 {summarized}건 요약 (머리기사 포함)
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

              {shown.map((item) => {
                // 저장소 이름이 있으면 그것이 제목이고 AI 제목이 설명으로 내려간다.
                // 어느 쪽이든 좁은 열에서 글덩어리가 되지 않게 텍스트 블록은 최대 두 개다.
                const repo = repoLabelOf(item);
                const lede = repo ? item.title : item.deck;
                const meta = metaTextOf(item);
                const collected = collectedLabelOf(item);

                return (
                  <div key={item.source_url} className={s.groupItem}>
                    <Link
                      href={routes.trend(item)}
                      className={repo ? s.groupItemRepo : s.groupItemTitle}
                    >
                      {repo ?? item.title}
                    </Link>
                    {lede && <div className={s.groupItemLede}>{lede}</div>}
                    <div className={s.groupItemMeta}>
                      {collected && <span className={s.metaDate}>{collected}</span>}
                      {meta && <span className={s.metaMono}>{meta}</span>}
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className={s.originLink}
                      >
                        원문 ↗
                      </a>
                    </div>
                    {canSave && (
                      <div className={s.groupItemSave}>
                        <ScrapButton
                          targetType="trend"
                          targetKey={item.source_url}
                          initialSaved={saved?.has(item.source_url) ?? false}
                        />
                      </div>
                    )}
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
