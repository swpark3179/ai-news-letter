import Link from "next/link";
import { CATEGORIES } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { formatIssue, kstDateString, longDateKo, shortDateKo } from "@/lib/format";
import type { EditionSlot } from "@/lib/data/feed";
import type { CategoryKey } from "@/types/db";
import s from "./home.module.css";
import { slotNote } from "./slotNote";

interface Props {
  issueNo: number;
  /** 다섯 카테고리 중 가장 늦은 수집일 (YYYY-MM-DD). 아직 하나도 없으면 null */
  editionDate: string | null;
  slots: Record<CategoryKey, EditionSlot>;
  today: Date;
}

/**
 * 수집 상태 알약 — 지면이 오늘 수집분인지 알려 준다.
 *
 * 예전에는 sync_runs 를 읽어 「자동 수집 정상」을 띄웠지만, 웹은 이제 앱과 같은 anon
 * 뷰만 읽고 sync_runs 는 열려 있지 않다. 그래서 지면에 걸린 수집일로 판단한다.
 */
function collectStatus(editionDate: string | null, today: Date) {
  if (!editionDate) return { ok: false, label: "수집 대기 중" };
  if (editionDate === kstDateString(today)) {
    return { ok: true, label: `오늘 수집분 · ${shortDateKo(editionDate)}` };
  }
  return { ok: false, label: `최근 수집분 · ${shortDateKo(editionDate)}` };
}

export default function Masthead({ issueNo, editionDate, slots, today }: Props) {
  const status = collectStatus(editionDate, today);

  return (
    <>
      <div className={s.mastRow}>
        <span>{formatIssue(issueNo)}</span>
        <span className={s.mastDate}>{longDateKo(today)}</span>
        <span className={s.mastSchedule}>매일 07:00 KST 발행</span>
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
        {CATEGORIES.map((c) => (
          <Link key={c.key} href={routes.category(c.key)} className={s.sectionLink}>
            <span className={s.sectionKo}>{c.ko}</span>
            <span className={s.sectionCount}>{slotNote(slots[c.key], today)}</span>
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
