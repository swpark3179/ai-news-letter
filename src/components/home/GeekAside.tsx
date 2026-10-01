import Link from "next/link";
import { routes } from "@/lib/routes";
import { shortDot } from "@/lib/format";
import type { FeedItem } from "@/types/feed";
import s from "./home.module.css";

interface Props {
  geek: FeedItem[];
}

/** 우측 사이드바 — 긱뉴스 데일리 (디자인 263~305행) */
export default function GeekAside({ geek }: Props) {
  const updatedAt = geek[0]?.collected_date;

  return (
    <aside className={s.aside}>
      <div className={s.asideHead}>
        <div>
          <div className={s.asideTitle}>긱뉴스 데일리</div>
          <div className={s.asideEn}>GeekNews Daily</div>
        </div>
        <span className={s.asideUpdated}>
          {updatedAt ? `${shortDot(updatedAt)} 갱신` : "수집 대기"}
        </span>
      </div>

      {geek.length === 0 && (
        <div className={s.groupEmpty}>
          아직 수집된 긱뉴스가 없습니다.
          <div className={s.emptyHint}>npm run sync:geeknews</div>
        </div>
      )}

      {geek.map((g) => (
        <div key={g.key} className={s.geekItem}>
          <div className={s.geekRow}>
            <span className={s.geekDate}>{shortDot(g.published_at)}</span>
            <div className={s.geekBody}>
              <a
                href={g.open_url}
                target="_blank"
                rel="noreferrer noopener"
                className={s.geekTitle}
              >
                {g.title}
              </a>
              <div className={s.geekMeta}>
                <span className={s.geekSrc}>{g.host || "news.hada.io"}</span>
                {g.origin_url && (
                  <a
                    href={g.origin_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={s.geekOrigin}
                  >
                    원문 ↗
                  </a>
                )}
                <span className={s.geekPts}>{g.score ?? 0}</span>
              </div>
            </div>
          </div>
        </div>
      ))}

      <Link href={routes.section("geek")} className={s.asideMore}>
        긱뉴스 전체 보기 →
      </Link>
    </aside>
  );
}
