import Link from "next/link";
import { routes } from "@/lib/routes";
import { hhmm } from "@/lib/format";
import type { GeekNewsRow } from "@/types/db";
import type { RotationWithMember } from "@/lib/data/content";
import s from "./home.module.css";

interface Props {
  geek: GeekNewsRow[];
  duty: RotationWithMember[];
  showEn: boolean;
}

const DUTY_STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  done: { label: "작성 완료", fg: "var(--green-700)", bg: "var(--green-50)" },
  reviewing: { label: "검토 중", fg: "var(--yellow-800)", bg: "var(--yellow-50)" },
  preparing: { label: "준비 중", fg: "var(--purple-700)", bg: "var(--purple-50)" },
  planned: { label: "예정", fg: "var(--gray-600)", bg: "var(--gray-100)" },
};

/** 우측 사이드바 — 긱뉴스 데일리 + 이번 주 당번 (디자인 263~305행) */
export default function GeekAside({ geek, duty, showEn }: Props) {
  const updatedAt = geek[0]?.collected_at ?? geek[0]?.published_at;

  return (
    <aside className={s.aside}>
      <div className={s.asideHead}>
        <div>
          <div className={s.asideTitle}>긱뉴스 데일리</div>
          {showEn && <div className={s.asideEn}>GeekNews Daily</div>}
        </div>
        <span className={s.asideUpdated}>
          {updatedAt ? `${hhmm(updatedAt)} 갱신` : "수집 대기"}
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
            <span className={s.geekTime}>{hhmm(g.published_at)}</span>
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

      {duty.length > 0 && (
        <div className={s.dutyCard}>
          <div className={s.dutyTitle}>이번 주 당번</div>
          <div className={s.dutyList}>
            {duty.map((d) => {
              const st = DUTY_STATUS[d.status] ?? DUTY_STATUS.planned;
              const name = d.member?.name ?? "미지정";
              return (
                <div key={d.id}>
                  <div className={s.dutyRow}>
                    <div className={s.dutyAvatar}>
                      {d.member?.initial ?? name.slice(-2)}
                    </div>
                    <span className={s.dutyName}>{name}</span>
                    <span
                      className={s.dutyStatus}
                      style={{ color: st.fg, background: st.bg }}
                    >
                      {st.label}
                    </span>
                  </div>
                  {d.topic && <div className={s.dutyTopic}>{d.topic}</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </aside>
  );
}
