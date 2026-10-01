import { shortDateKo } from "@/lib/format";
import type { FeedItem } from "@/types/feed";
import ItemRow from "./ItemRow";
import s from "./section.module.css";

/** 수집한 날마다 구분선을 넣는다. items 는 이미 날짜 역순이다 (getCategoryWindow). */
export default function DayGroups({ items }: { items: FeedItem[] }) {
  const days: { date: string; items: FeedItem[] }[] = [];
  for (const item of items) {
    const last = days.at(-1);
    if (last && last.date === item.collected_date) last.items.push(item);
    else days.push({ date: item.collected_date, items: [item] });
  }

  return (
    <>
      {days.map((d) => (
        <section key={d.date} className={s.day} aria-label={shortDateKo(d.date)}>
          <h2 className={s.dayHead}>
            <span className={s.dayDate}>{shortDateKo(d.date)}</span>
            <span className={s.dayCount}>{d.items.length}건</span>
          </h2>
          {d.items.map((item, i) => (
            <ItemRow key={item.key} item={item} index={i} />
          ))}
        </section>
      ))}
    </>
  );
}
