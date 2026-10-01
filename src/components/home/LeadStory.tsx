import Link from "next/link";
import { sourceStyleOf } from "@/lib/domain";
import { shortDateKo } from "@/lib/format";
import { routes } from "@/lib/routes";
import type { TrendDetail } from "@/types/feed";
import s from "./home.module.css";

interface Props {
  lead: TrendDetail | null;
}

/**
 * 머리기사 — 3단 조판 + 드롭캡 (디자인 205~230행).
 * 좁은 화면에서는 단 수가 줄어든다 (home.module.css 의 .leadBody).
 */
export default function LeadStory({ lead }: Props) {
  if (!lead) {
    return (
      <div className={s.emptyBlock}>
        아직 오늘의 머리기사가 없습니다.
        <div className={s.emptyHint}>npm run sync:trend</div>
      </div>
    );
  }

  const style = sourceStyleOf(lead.source);
  const href = routes.trend(lead);

  // 첫 문단의 첫 글자를 드롭캡으로 떼어 낸다.
  const paragraphs = lead.body.filter((b) => b.type === "text").map((b) => b.t);
  const [first = "", ...rest] = paragraphs;
  const dropcap = first.slice(0, 1);
  const firstRest = first.slice(1);

  return (
    <>
      <div className={s.leadKickerRow}>
        <span className={s.leadKicker}>오늘의 머리기사</span>
        <span className={s.dotSep} />
        <span className={s.leadNote}>
          {style.label} · {shortDateKo(lead.collected_date)} 수집
        </span>
      </div>

      {lead.repo && <div className={s.leadRepo}>{lead.repo}</div>}

      <Link href={href} className={s.leadTitle}>
        <h1 style={{ font: "inherit", letterSpacing: "inherit", margin: 0 }}>
          {lead.title}
        </h1>
      </Link>

      {lead.deck && <p className={s.leadDeck}>{lead.deck}</p>}

      <div className={s.leadSources}>
        <a
          href={lead.key}
          target="_blank"
          rel="noreferrer noopener"
          className={s.srcLink}
        >
          <span
            className={s.srcTag}
            style={{ background: style.bg, color: style.fg }}
          >
            {style.tag}
          </span>
          <span className={s.srcLabel}>
            {style.label} · {lead.raw_title || "원본"}
          </span>
        </a>
        <span className={s.leadSourcesNote}>원문 1건 요약</span>
      </div>

      <div className={s.leadBody}>
        {dropcap && <span className={s.dropcap}>{dropcap}</span>}
        {firstRest && <p>{firstRest}</p>}
        {rest.map((t, i) => (
          <p key={i}>{t}</p>
        ))}
        <Link href={href} className={s.readMore}>
          전문 읽기 →
        </Link>
      </div>
    </>
  );
}
