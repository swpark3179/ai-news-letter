import Link from "next/link";
import { notFound } from "next/navigation";
import Markdown from "./Markdown";
import RelatedCard, { type RelatedItem } from "./RelatedCard";
import s from "./article.module.css";
import { CATEGORY_MAP } from "@/lib/domain";
import { dotDate } from "@/lib/format";
import { hadaKeyFrom, routes, type HadaKind } from "@/lib/routes";
import { getCategoryDay, getHadaContent, getHadaItem } from "@/lib/data/feed";
import type { FeedItem } from "@/types/feed";

/** 상세 라우트 두 개(/articles/geek · /articles/show)의 제목 */
export async function hadaTitle(kind: HadaKind, segments: string[]): Promise<string> {
  const key = hadaKeyFrom(segments);
  const item = key ? await getHadaItem(kind, key).catch(() => null) : null;
  return item?.title ?? CATEGORY_MAP[kind].ko;
}

interface OutLink {
  tag: string;
  label: string;
  href: string;
}

function sourceLinks(kind: HadaKind, item: FeedItem): OutLink[] {
  const links: OutLink[] = [];
  if (kind === "geek" && item.origin_url) {
    links.push({ tag: "원문", label: item.host || item.origin_url, href: item.origin_url });
  }
  if (kind === "show" && item.open_url !== item.key) {
    links.push({ tag: "만든 것", label: item.host || item.open_url, href: item.open_url });
  }
  links.push({ tag: "토론", label: "news.hada.io 댓글", href: item.key });
  return links;
}

/**
 * 긱뉴스 · 쇼케이스 상세.
 *
 * 앱의 HadaDetailScreen 과 같은 화면이다 — news.hada.io 페이지에 광고가 섞여 읽기
 * 불편하다는 이유로 본문만 담아 두었고(0015 · 0017), 여기서 그것을 보여 준다.
 * 본문이 아직 없으면 막다른 길이 되지 않게 원문 링크로 넘긴다.
 */
export default async function HadaArticle({
  kind,
  segments,
}: {
  kind: HadaKind;
  segments: string[];
}) {
  const key = hadaKeyFrom(segments);
  if (!key) notFound();

  const [item, content] = await Promise.all([getHadaItem(kind, key), getHadaContent(key)]);
  // 감춘 글은 목록 뷰에도 본문 뷰에도 없다.
  if (!item) notFound();

  const def = CATEGORY_MAP[kind];
  const sameDay = await getCategoryDay(kind, item.collected_date);
  const related: RelatedItem[] = sameDay
    .filter((i) => i.key !== item.key)
    .slice(0, 4)
    .flatMap((i) => {
      const href = routes.hada(kind, i.key);
      return href
        ? [{ href, kicker: def.ko, title: i.title, byline: i.meta }]
        : [];
    });

  const primary = sourceLinks(kind, item)[0];

  return (
    <div className={s.wrap}>
      <div className={s.paper}>
        <Link href={routes.category(kind)} className={s.back}>
          ← {def.ko}
        </Link>

        <div className={s.head}>
          <div className={s.kicker}>
            {def.ko}
            {item.host ? ` · ${item.host}` : ""}
          </div>
          <h1 className={s.title}>{item.title}</h1>
          {/* 요약은 본문 첫머리를 자른 것이라 본문이 있으면 되풀이하지 않는다 (앱 HadaDetailScreen 과 같음). */}
          {!content && item.lede && <p className={s.deck}>{item.lede}</p>}
        </div>

        <div className={s.bylineBar}>
          <div className={s.byline}>
            <span
              className={s.srcBadge}
              style={{ background: def.badge.bg, color: def.badge.fg }}
            >
              {def.badge.tag}
            </span>
            <span className={s.srcNote}>
              {dotDate(item.published_at)} 게시
              {item.maker ? ` · ${item.maker}` : ""}
              {item.meta ? ` · ${item.meta}` : ""}
            </span>
          </div>
        </div>

        <div className={s.contentGrid}>
          <div className={s.main}>
            {content ? (
              <>
                <Markdown source={content.body_md} />
                {content.truncated && (
                  <p className={s.notice}>
                    글이 길어 앞부분만 옮겨 왔습니다.{" "}
                    <a href={item.key} target="_blank" rel="noreferrer noopener">
                      나머지는 news.hada.io 에서 읽기 ↗
                    </a>
                  </p>
                )}
              </>
            ) : (
              <p className={s.notice}>
                본문을 아직 옮겨 오지 못했습니다.{" "}
                <a href={primary.href} target="_blank" rel="noreferrer noopener">
                  {primary.tag === "토론" ? "news.hada.io 에서 읽기 ↗" : "원문에서 읽기 ↗"}
                </a>
              </p>
            )}
          </div>

          <aside className={s.aside}>
            <div className={s.asideSticky}>
              <div className={s.card}>
                <div className={s.cardTitle}>원문 소스</div>
                <div className={s.sourceList}>
                  {sourceLinks(kind, item).map((l) => (
                    <a
                      key={l.href}
                      href={l.href}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={s.sourceRow}
                    >
                      <span
                        className={s.sourceTag}
                        style={{ background: def.badge.bg, color: def.badge.fg }}
                      >
                        {l.tag}
                      </span>
                      <span className={s.sourceLabel}>{l.label}</span>
                      <span className={s.sourceArrow}>↗</span>
                    </a>
                  ))}
                </div>
              </div>

              <RelatedCard items={related} title="같은 날 들어온 글" />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
