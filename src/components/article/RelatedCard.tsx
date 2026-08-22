import Link from "next/link";
import s from "./article.module.css";

export interface RelatedItem {
  href: string;
  kicker: string;
  title: string;
  byline: string;
}

/** 사이드바 "함께 읽기" (디자인 557~568행) */
export default function RelatedCard({ items }: { items: RelatedItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className={s.card}>
      <div className={s.cardTitle}>함께 읽기</div>
      <div className={s.relatedList}>
        {items.map((r) => (
          <Link key={r.href} href={r.href} className={s.relatedItem}>
            <div className={s.relatedKicker}>{r.kicker}</div>
            <div className={s.relatedTitle}>{r.title}</div>
            <div className={s.relatedByline}>{r.byline}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
