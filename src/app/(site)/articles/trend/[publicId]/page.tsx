import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ArticleBody from "@/components/article/ArticleBody";
import RelatedCard, { type RelatedItem } from "@/components/article/RelatedCard";
import ScrapButton from "@/components/scrap/ScrapButton";
import s from "@/components/article/article.module.css";
import { SECTION_MAP, SRC, TREND_SOURCE_TO_KIND, sourceStyleOf } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { dotDate } from "@/lib/format";
import { getTrendItemByPublicId, getTrendItems } from "@/lib/data/content";
import { getSessionUser } from "@/lib/auth/current-user";
import { isSaved } from "@/lib/data/scraps";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ publicId: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { publicId } = await params;
  const t = await getTrendItemByPublicId(publicId).catch(() => null);
  return { title: t?.title ?? "트렌드 브리핑" };
}

/**
 * 트렌드 브리핑 상세.
 *
 * 유닛원이 쓴 기사와 달리 작성자가 없고 "AI 자동 요약 · 원문 1건" 표기를 쓴다
 * (디자인 454~459행의 showSource 분기).
 */
export default async function TrendArticlePage({ params }: Props) {
  const { publicId } = await params;
  const item = await getTrendItemByPublicId(publicId);

  if (!item || item.status === "hidden") notFound();

  const style = sourceStyleOf(item.source);
  const kindLabel = SRC[TREND_SOURCE_TO_KIND[item.source]].label;

  const user = await getSessionUser();
  const saved = user ? await isSaved(user.id, "trend", item.source_url) : false;

  const siblings = await getTrendItems({ limit: 8 });
  const related: RelatedItem[] = siblings
    .filter((t) => t.source_url !== item.source_url)
    .slice(0, 3)
    .map((t) => ({
      href: routes.trend(t),
      kicker: SECTION_MAP.trend.ko,
      title: t.title,
      byline: `${SRC[TREND_SOURCE_TO_KIND[t.source]].tag} · ${dotDate(t.collected_date)}`,
    }));

  return (
    <div className={s.wrap}>
      <div className={s.paper}>
        <Link href={routes.section("trend")} className={s.back}>
          ← 트렌드 브리핑
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
              {item.llm_provider ? ` · ${item.llm_provider}/${item.llm_model}` : ""}
            </span>
          </div>

          {user && (
            <ScrapButton
              targetType="trend"
              targetKey={item.source_url}
              initialSaved={saved}
              variant="byline"
            />
          )}
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
                    href={item.source_url}
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
                      {item.raw_title ?? item.source_url}
                    </span>
                    <span className={s.sourceArrow}>↗</span>
                  </a>

                  {typeof item.metrics?.hn_external_url === "string" && (
                    <a
                      href={item.metrics.hn_external_url}
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

              <RelatedCard items={related} />
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
