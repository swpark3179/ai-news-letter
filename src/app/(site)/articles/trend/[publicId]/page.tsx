import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ArticleBody from "@/components/article/ArticleBody";
import RelatedCard, { type RelatedItem } from "@/components/article/RelatedCard";
import s from "@/components/article/article.module.css";
import { CATEGORY_MAP, SRC, TREND_SOURCE_TO_KIND, categoryOfTrend, sourceStyleOf } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { dotDate } from "@/lib/format";
import { getCategoryDay, getTrendDetail } from "@/lib/data/feed";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ publicId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { publicId } = await params;
  const t = await getTrendDetail(publicId).catch(() => null);
  return { title: t?.title ?? "트렌드 브리핑" };
}

/**
 * 트렌드 브리핑 상세.
 *
 * 작성자 대신 "AI 자동 요약 · 원문 1건" 표기를 쓴다
 * (디자인 454~459행의 showSource 분기).
 */
export default async function TrendArticlePage({ params }: Props) {
  const { publicId } = await params;
  // 공개되지 않은 항목(status 가 published 가 아닌 것)은 뷰에 아예 없다.
  const item = await getTrendDetail(publicId);
  if (!item) notFound();

  const style = sourceStyleOf(item.source);
  const kindLabel = SRC[TREND_SOURCE_TO_KIND[item.source]].label;

  // 함께 읽기 — 같은 날 같은 출처에서 들어온 것 중 지표가 큰 순서
  const category = CATEGORY_MAP[categoryOfTrend(item.source)];
  const sameDay = await getCategoryDay(category.key, item.collected_date);
  const related: RelatedItem[] = sameDay
    .filter((t) => t.key !== item.key)
    .slice(0, 4)
    .flatMap((t) => {
      // trend_items.source 가 geeknews 인 행은 긱뉴스 카테고리로 묶여 이웃이 긱뉴스 글이 된다.
      const href = routes.item(t);
      return href ? [{ t, href }] : [];
    })
    .map(({ t, href }) => ({
      href,
      kicker: t.repo ?? category.badge.label,
      title: t.title,
      byline: t.meta || dotDate(t.collected_date),
    }));

  return (
    <div className={s.wrap}>
      <div className={s.paper}>
        <Link href={routes.category(category.key)} className={s.back}>
          ← {category.ko}
        </Link>

        <div className={s.head}>
          <div className={s.kicker}>
            트렌드 브리핑 · {kindLabel}
            {item.source_variant ? ` ${item.source_variant}` : ""}
          </div>
          <h1 className={s.title}>{item.title}</h1>
          {item.deck && <p className={s.deck}>{item.deck}</p>}
        </div>

        <div className={s.bylineBar}>
          <div className={s.byline}>
            <span
              className={s.srcBadge}
              style={{ background: style.bg, color: style.fg }}
            >
              {style.tag}
            </span>
            <span className={s.srcNote}>
              {dotDate(item.collected_date)} 자동 수집 · 원문 1건을 요약한 게시물입니다
              {item.llm_model ? ` · ${item.llm_model}` : ""}
            </span>
          </div>
        </div>

        <div className={s.contentGrid}>
          <div className={s.main}>
            <ArticleBody blocks={item.body} />
          </div>

          <aside className={s.aside}>
            <div className={s.asideSticky}>
              <div className={s.card}>
                <div className={s.cardTitle}>원문 소스</div>
                <div className={s.sourceList}>
                  <a
                    href={item.key}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={s.sourceRow}
                  >
                    <span
                      className={s.sourceTag}
                      style={{ background: style.bg, color: style.fg }}
                    >
                      {style.tag}
                    </span>
                    <span className={s.sourceLabel}>
                      {item.raw_title || item.key}
                    </span>
                    <span className={s.sourceArrow}>↗</span>
                  </a>

                  {item.origin_url && (
                    <a
                      href={item.origin_url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className={s.sourceRow}
                    >
                      <span
                        className={s.sourceTag}
                        style={{ background: "var(--gray-100)", color: "var(--gray-800)" }}
                      >
                        LINK
                      </span>
                      <span className={s.sourceLabel}>스레드가 가리키는 원문</span>
                      <span className={s.sourceArrow}>↗</span>
                    </a>
                  )}
                </div>
              </div>

              {item.tags.length > 0 && (
                <div className={s.card}>
                  <div className={s.cardTitle}>태그</div>
                  <div
                    style={{
                      marginTop: 12,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    {item.tags.map((t) => (
                      <span
                        key={t}
                        style={{
                          fontSize: 10.5,
                          fontFamily: "var(--font-mono)",
                          color: "var(--gray-600)",
                          background: "var(--gray-100)",
                          padding: "3px 8px",
                          borderRadius: "var(--radius-sm)",
                        }}
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <RelatedCard items={related} title="같은 날 들어온 글" />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
