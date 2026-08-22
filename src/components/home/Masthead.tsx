import Link from "next/link";
import { SECTIONS } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { formatIssue, longDateKo } from "@/lib/format";
import type { PublishSettings } from "@/lib/data/settings";
import s from "./home.module.css";

interface Props {
  settings: PublishSettings;
  /** 각 카테고리 옆에 붙는 건수 문구 */
  counts: Record<string, string>;
  /** 마지막 동기화 성공 시각 (없으면 '수집 대기') */
  lastSync: { label: string; ok: boolean };
  today: Date;
}

export default function Masthead({ settings, counts, lastSync, today }: Props) {
  return (
    <>
      <div className={s.mastRow}>
        <span>{formatIssue(settings.issueNo)}</span>
        <span className={s.mastDate}>{longDateKo(today)}</span>
        <span>{settings.publisher}</span>
      </div>

      <div className={s.titleBlock}>
        <div className={s.kicker}>Daily Digest for the AI Unit</div>
        <div className={s.titleRow}>
          <span className={s.titleAi}>AI</span>
          <span className={s.titleKo}>뉴스레터</span>
        </div>
        <div className={s.tagline}>
          매일 아침 7시, 흩어진 AI 소식을 한 장으로 · 유닛의 리뷰와 심층 분석을 함께
        </div>
      </div>

      <div className={s.ruleThick} />
      <div className={s.ruleThin} />

      <div className={s.sectionNav}>
        {SECTIONS.map((sec) => (
          <Link key={sec.key} href={routes.section(sec.key)} className={s.sectionLink}>
            <span className={s.sectionKo}>{sec.ko}</span>
            {settings.showEnSubtitles && <span className={s.sectionEn}>{sec.en}</span>}
            <span className={s.sectionCount}>{counts[sec.key] ?? ""}</span>
          </Link>
        ))}

        <span className={`${s.statusPill} ${lastSync.ok ? "" : s.statusPillStale}`}>
          <span className={`${s.statusDot} ${lastSync.ok ? "" : s.statusDotStale}`} />
          {lastSync.label}
        </span>
      </div>
    </>
  );
}
