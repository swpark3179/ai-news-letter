import Link from "next/link";
import { routes } from "@/lib/routes";
import { shortDot } from "@/lib/format";
import type { GeekNewsRow } from "@/types/db";
import s from "./home.module.css";

interface Props {
  geek: GeekNewsRow[];
  showEn: boolean;
}

/** 우측 사이드바 — 긱뉴스 데일리 (디자인 263~305행) */
export default function GeekAside({ geek, showEn }: Props) {
  const updatedAt = geek[0]?.collected_at ?? geek[0]?.published_at;

  return (
    <aside className={s.aside}>
      <div className={s.asideHead}>
        <div>
          <div className={s.asideTitle}>긱뉴스 데일리</div>
          {showEn && <div className={s.asideEn}>GeekNews Daily</div>}
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
        <div key={g.url} className={s.geekItem}>
          <div className={s.geekRow}>
            <span className={s.geekDate}>{shortDot(g.published_at)}</span>
            <div className={s.geekBody}>
              <a
                href={g.url}
                target="_blank"
                rel="noreferrer noopener"
                className={s.geekTitle}
              >
                {g.title}
              </a>
              <div className={s.geekMeta}>
                <span className={s.geekSrc}>{g.source_domain ?? "news.hada.io"}</span>
                {g.external_url && (
                  <a
                    href={g.external_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={s.geekOrigin}
                  >
                    원문 ↗
                  </a>
                )}
                <span className={s.geekPts}>{g.points}</span>
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
