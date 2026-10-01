import Link from "next/link";
import { CATEGORY_MAP } from "@/lib/domain";
import { routes } from "@/lib/routes";
import type { EditionSlot } from "@/lib/data/feed";
import type { FeedItem } from "@/types/feed";
import s from "./home.module.css";
import { slotNote } from "./slotNote";

interface Props {
  geek: EditionSlot;
  show: EditionSlot;
  today: Date;
}

/**
 * 우측 사이드바 — 긱뉴스와 쇼케이스 (디자인 263~305행).
 *
 * 제목은 이 사이트의 본문 상세로 간다 — news.hada.io 페이지는 광고가 섞여 읽기 불편하다는
 * 이유로 본문을 따로 담아 두었다(0015 · 0017, 앱의 HadaDetailScreen 과 같은 이유).
 */
export default function GeekAside({ geek, show, today }: Props) {
  return (
    <aside className={s.aside}>
      <AsideBlock kind="geek" slot={geek} today={today} />
      <div className={s.asideGap} />
      <AsideBlock kind="show" slot={show} today={today} />
    </aside>
  );
}

function AsideBlock({
  kind,
  slot,
  today,
}: {
  kind: "geek" | "show";
  slot: EditionSlot;
  today: Date;
}) {
  const def = CATEGORY_MAP[kind];

  return (
    <section aria-label={def.ko}>
      <div className={s.asideHead}>
        <div>
          <div className={s.asideTitle}>{def.ko}</div>
          <div className={s.asideEn}>{def.en}</div>
        </div>
        <span className={s.asideUpdated}>{slotNote(slot, today)}</span>
      </div>

      {slot.items.length === 0 && (
        <div className={s.groupEmpty}>아직 수집된 글이 없습니다.</div>
      )}

      {slot.items.map((g) => (
        <AsideItem key={g.key} item={g} kind={kind} />
      ))}

      <Link href={routes.category(kind)} className={s.asideMore}>
        {def.ko} 지난 목록 →
      </Link>
    </section>
  );
}

function AsideItem({ item, kind }: { item: FeedItem; kind: "geek" | "show" }) {
  const detail = routes.hada(kind, item.key);
  // 긱뉴스는 소개한 글(origin_url), 쇼케이스는 만든 것의 주소(open_url)가 「원문」이다.
  const outbound = kind === "geek" ? item.origin_url : item.open_url !== item.key ? item.open_url : null;

  return (
    <div className={s.geekItem}>
      {detail ? (
        <Link href={detail} className={s.geekTitle}>
          {item.title}
        </Link>
      ) : (
        <a href={item.open_url} target="_blank" rel="noreferrer noopener" className={s.geekTitle}>
          {item.title}
        </a>
      )}
      <div className={s.geekMeta}>
        <span className={s.geekSrc}>{item.host || "news.hada.io"}</span>
        {outbound && (
          <a href={outbound} target="_blank" rel="noreferrer noopener" className={s.geekOrigin}>
            {kind === "geek" ? "원문 ↗" : "만든 것 ↗"}
          </a>
        )}
        <span className={s.geekPts}>{item.score ?? 0} points</span>
      </div>
    </div>
  );
}
