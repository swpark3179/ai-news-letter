import Link from "next/link";
import { SECTIONS } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { formatIssue, kstDateString, longDateKo, shortDateKo } from "@/lib/format";
import s from "./home.module.css";

interface Props {
  issueNo: number;
  /** 각 카테고리 옆에 붙는 건수 문구 */
  counts: Record<string, string>;
  /** 지면에 걸린 트렌드의 수집일 (YYYY-MM-DD). 아직 하나도 없으면 null */
  collectedDate: string | null;
  today: Date;
}

/**
 * 수집 상태 알약 — 지면이 오늘 수집분인지 알려 준다.
 *
 * 예전에는 sync_runs 를 읽어 「자동 수집 정상」을 띄웠지만, 웹은 이제 앱과 같은 anon
 * 뷰만 읽고 sync_runs 는 열려 있지 않다. 그래서 지면에 걸린 수집일로 판단한다.
 */
function collectStatus(collectedDate: string | null, today: Date) {
  if (!collectedDate) return { ok: false, label: "수집 대기 중" };
  if (collectedDate === kstDateString(today)) {
    return { ok: true, label: `오늘 수집분 · ${shortDateKo(collectedDate)}` };
  }
  return { ok: false, label: `최근 수집분 · ${shortDateKo(collectedDate)}` };
}

export default function Masthead({ issueNo, counts, collectedDate, today }: Props) {
  const status = collectStatus(collectedDate, today);

  return (
    <>
      <div className={s.mastRow}>
        <span>{formatIssue(issueNo)}</span>
        <span className={s.mastDate}>{longDateKo(today)}</span>
        <span>매일 07:00 KST 발행</span>
      </div>

      <div className={s.titleBlock}>
        <div className={s.kicker}>Daily AI Digest</div>
        <div className={s.titleRow}>
          <span className={s.titleAi}>AI</span>
          <span className={s.titleKo}>뉴스레터</span>
        </div>
        <div className={s.tagline}>매일 아침 7시, 흩어진 AI 소식을 한 장으로</div>
      </div>

      <div className={s.ruleThick} />
      <div className={s.ruleThin} />

      <div className={s.sectionNav}>
        {SECTIONS.map((sec) => (
          <Link key={sec.key} href={routes.section(sec.key)} className={s.sectionLink}>
            <span className={s.sectionKo}>{sec.ko}</span>
            <span className={s.sectionEn}>{sec.en}</span>
            <span className={s.sectionCount}>{counts[sec.key] ?? ""}</span>
          </Link>
        ))}

        <span className={`${s.statusPill} ${status.ok ? "" : s.statusPillStale}`}>
          <span className={`${s.statusDot} ${status.ok ? "" : s.statusDotStale}`} />
          {status.label}
        </span>
      </div>
    </>
  );
}
