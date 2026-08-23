import Link from "next/link";
import ScrapButton from "@/components/scrap/ScrapButton";
import { sourceStyleOf } from "@/lib/domain";
import { hhmm, shortDateKo } from "@/lib/format";
import { routes } from "@/lib/routes";
import { repoLabelOf } from "@/lib/trendItem";
import type { TrendItemRow } from "@/types/db";
import s from "./home.module.css";

interface Props {
  lead: TrendItemRow | null;
  /** 로그인 사용자에게만 보관 버튼을 붙인다 */
  canSave?: boolean;
  /** 이미 보관한 trend_items.source_url 집합 */
  saved?: Set<string>;
}

/** 머리기사 — 3단 조판 + 드롭캡 (디자인 205~230행) */
export default function LeadStory({ lead, canSave = false, saved }: Props) {
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
  const repo = repoLabelOf(lead);

  // 첫 문단의 첫 글자를 드롭캡으로 떼어 낸다.
  const paragraphs = lead.body.filter((b) => b.type === "text").map((b) => b.t);
  const [first = "", ...rest] = paragraphs;
  const dropcap = first.slice(0, 1);
  const firstRest = first.slice(1);

  return (
    <>
      <div className={s.leadKickerRow}>
        <span className={s.leadKicker}>트렌드 브리핑</span>
        <span className={s.dotSep} />
        <span className={s.leadNote}>
          {shortDateKo(lead.collected_date)} {hhmm(lead.collected_at)} 수집
        </span>
      </div>

      {repo && <div className={s.leadRepo}>{repo}</div>}

      <Link href={href} className={s.leadTitle}>
        <h1 style={{ font: "inherit", letterSpacing: "inherit", margin: 0 }}>
          {lead.title}
        </h1>
      </Link>

      {lead.deck && <p className={s.leadDeck}>{lead.deck}</p>}

      <div className={s.leadSources}>
        <a
          href={lead.source_url}
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
            {style.label} · {lead.raw_title ?? "원본"}
          </span>
        </a>
        <span className={s.leadSourcesNote}>원문 1건 요약</span>
        {canSave && (
          <ScrapButton
            targetType="trend"
            targetKey={lead.source_url}
            initialSaved={saved?.has(lead.source_url) ?? false}
          />
        )}
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
