import Link from "next/link";
import { CATEGORY_MAP, TREND_CATEGORIES } from "@/lib/domain";
import { routes } from "@/lib/routes";
import type { EditionSlot } from "@/lib/data/feed";
import type { FeedItem } from "@/types/feed";
import s from "./home.module.css";
import { slotNote } from "./slotNote";

type TrendCategory = (typeof TREND_CATEGORIES)[number];

interface Props {
  slots: Record<TrendCategory, EditionSlot>;
  /** 머리기사로 올라간 항목 — 열에서는 뺀다 */
  leadKey?: string;
  today: Date;
}

/** 열마다 요약까지 보여 주는 건수. 나머지는 제목만 이어 싣는다. */
const FEATURED = 3;

/**
 * 「오늘의 트렌드」 3열 (디자인 232~258행).
 *
 * 그날 들어온 것을 **전부** 싣는다 — 웹은 어제 무엇을 읽었는지 기억해 주지 않으니,
 * 1면만 훑어도 그날 것을 빠짐없이 볼 수 있어야 한다. 위의 몇 건만 요약을 붙이고
 * 나머지는 제목 한 줄씩이라 열이 글덩어리가 되지 않는다.
 */
export default function TrendGroups({ slots, leadKey, today }: Props) {
  const total = TREND_CATEGORIES.reduce((n, k) => n + slots[k].items.length, 0);

  return (
    <div className={s.todayBlock}>
      <div className={s.todayHead}>
        <span className={s.todayTitle}>오늘의 트렌드</span>
        <span className={s.todayNote}>
          GitHub · Hacker News · arXiv 를 AI 가 한국어로 요약 · {total}건
        </span>
      </div>

      <div className={s.groupGrid}>
        {TREND_CATEGORIES.map((key, gi) => {
          const def = CATEGORY_MAP[key];
          const slot = slots[key];
          const items = slot.items.filter((i) => i.key !== leadKey);
          const featured = items.slice(0, FEATURED);
          const rest = items.slice(FEATURED);

          return (
            <section
              key={key}
              className={`${s.group} ${gi === 0 ? s.groupFirst : ""}`}
              aria-label={def.badge.label}
            >
              <div className={s.groupHead}>
                <span
                  className={s.groupTag}
                  style={{ background: def.badge.bg, color: def.badge.fg }}
                >
                  {def.badge.tag}
                </span>
                <span className={s.groupNote}>{slotNote(slot, today)}</span>
              </div>

              {items.length === 0 && (
                <div className={s.groupEmpty}>
                  {slot.items.length > 0 ? "머리기사 한 건이 전부입니다." : "아직 수집된 항목이 없습니다."}
                </div>
              )}

              {featured.map((item) => (
                <FeaturedItem key={item.key} item={item} />
              ))}

              {rest.length > 0 && (
                <ul className={s.groupRest}>
                  {rest.map((item) => (
                    <li key={item.key} className={s.groupRestItem}>
                      <Link href={routes.trend(item)} className={s.groupRestTitle}>
                        {item.repo ?? item.title}
                      </Link>
                      {item.repo && <div className={s.groupRestSub}>{item.title}</div>}
                    </li>
                  ))}
                </ul>
              )}

              <Link href={routes.category(key)} className={s.groupMore}>
                {def.ko} 지난 목록 →
              </Link>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function FeaturedItem({ item }: { item: FeedItem }) {
  // 저장소 이름이 있으면 그것이 제목이고 AI 제목이 설명으로 내려간다.
  // 어느 쪽이든 좁은 열에서 글덩어리가 되지 않게 텍스트 블록은 최대 두 개다.
  const repo = item.repo;
  const lede = repo ? item.title : item.lede;

  return (
    <div className={s.groupItem}>
      <Link href={routes.trend(item)} className={repo ? s.groupItemRepo : s.groupItemTitle}>
        {repo ?? item.title}
      </Link>
      {lede && <div className={s.groupItemLede}>{lede}</div>}
      <div className={s.groupItemMeta}>
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
}
