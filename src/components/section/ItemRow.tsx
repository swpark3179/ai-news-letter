import Link from "next/link";
import { CATEGORY_MAP, categoryOfTrend } from "@/lib/domain";
import { routes } from "@/lib/routes";
import type { CategoryKey } from "@/types/db";
import type { FeedItem } from "@/types/feed";
import s from "./section.module.css";

interface OutLink {
  label: string;
  href: string;
}

export function categoryOf(item: FeedItem): CategoryKey {
  if (item.type === "trend") return categoryOfTrend(item.source ?? "github");
  return item.type;
}

/** 이 사이트 밖으로 나가는 링크들 — 카테고리마다 「원문」이 가리키는 곳이 다르다 */
function outboundLinks(item: FeedItem): OutLink[] {
  const links: OutLink[] = [];
  if (item.type === "geek") {
    if (item.origin_url) links.push({ label: "원문 ↗", href: item.origin_url });
    links.push({ label: "긱뉴스 토론 ↗", href: item.open_url });
  } else if (item.type === "show") {
    if (item.open_url !== item.key) links.push({ label: "만든 것 ↗", href: item.open_url });
    links.push({ label: "긱뉴스 토론 ↗", href: item.key });
  } else {
    links.push({ label: "원문 ↗", href: item.open_url });
    if (item.origin_url) links.push({ label: "스레드가 가리키는 글 ↗", href: item.origin_url });
  }
  return links;
}

/**
 * 제목 위 작은 머리. 한 카테고리 목록에서는 카테고리 이름이 화면 제목과 같아 빼고,
 * 지표(meta)에 없는 것만 남긴다 — arXiv 분류, 쇼케이스의 만든 사람.
 */
function kicker(item: FeedItem, withCategory: boolean): string {
  const def = CATEGORY_MAP[categoryOf(item)];
  return [
    withCategory ? def.badge.label : null,
    item.source === "arxiv" ? item.source_variant : null,
    item.type === "show" && item.maker ? `만든 사람 ${item.maker}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

interface Props {
  item: FeedItem;
  index: number;
  /** 여러 카테고리가 섞이는 화면(/search)이면 true — 배지와 카테고리 이름을 붙인다 */
  withCategory?: boolean;
}

/** 카테고리 목록 · 검색 결과의 한 줄 (디자인 382~431행의 행 모양) */
export default function ItemRow({ item, index, withCategory = false }: Props) {
  const def = CATEGORY_MAP[categoryOf(item)];
  const detail = routes.item(item);
  // GitHub 행은 저장소 이름이 제목이고 AI 제목이 바로 아래 설명 줄이 된다.
  const repo = item.repo;
  const head = kicker(item, withCategory);
  const heading = <span className={repo ? s.rowRepo : s.rowTitle}>{repo ?? item.title}</span>;

  return (
    <article className={s.row}>
      <div className={s.rowIndex}>{String(index + 1).padStart(2, "0")}</div>

      <div className={s.rowMain}>
        {head && <div className={s.rowKicker}>{head}</div>}
        {detail ? (
          <Link href={detail} className={s.rowTitleLink}>
            {heading}
          </Link>
        ) : (
          <a href={item.open_url} target="_blank" rel="noreferrer noopener" className={s.rowTitleLink}>
            {heading}
          </a>
        )}
        {repo && <div className={s.rowLede}>{item.title}</div>}
        {item.lede && <div className={s.rowDeck}>{item.lede}</div>}
        <div className={s.rowTags}>
          {/* 긱뉴스 · 쇼케이스의 지표 문구는 이미 호스트로 시작한다 */}
          {item.type === "trend" && item.host && <span className={s.tag}>{item.host}</span>}
          {outboundLinks(item).map((l) => (
            <a
              key={l.href + l.label}
              href={l.href}
              target="_blank"
              rel="noreferrer noopener"
              className={s.outLink}
            >
              {l.label}
            </a>
          ))}
        </div>
      </div>

      <div className={s.rowRight}>
        {withCategory && (
          <span className={s.badge} style={{ background: def.badge.bg, color: def.badge.fg }}>
            {def.badge.tag}
          </span>
        )}
        {item.meta && <div className={s.rowMeta}>{item.meta}</div>}
      </div>
    </article>
  );
}
