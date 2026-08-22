import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import ArticleBody from "@/components/article/ArticleBody";
import CommentSection from "@/components/article/CommentSection";
import ArticleOwnerActions from "@/components/article/ArticleOwnerActions";
import RelatedCard, { type RelatedItem } from "@/components/article/RelatedCard";
import PhotoSlot from "@/components/ui/PhotoSlot";
import s from "@/components/article/article.module.css";
import { ROLE_LABEL, SECTION_MAP, SRC, avatarOf } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { dotDate, mb, shortDateKo } from "@/lib/format";
import { getArticleFull, getArticles } from "@/lib/data/content";
import { getArticleAttachment, storageUrl } from "@/lib/data/ops";
import { getViewer } from "@/lib/auth/current-user";
import { canEditArticle } from "@/lib/auth/permissions";
import { safeHref } from "@/lib/url";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const a = await getArticleFull(id).catch(() => null);
  return { title: a?.title ?? "기사" };
}

export default async function ArticlePage({ params }: Props) {
  const { id } = await params;
  const [article, viewer] = await Promise.all([getArticleFull(id), getViewer()]);

  if (!article) notFound();

  // 임시저장 글은 작성자 본인과 관리자만 미리 볼 수 있다.
  const canEdit = canEditArticle(viewer.user, article);
  const isPublished = article.status === "published";
  if (!isPublished && !canEdit) notFound();

  const section = SECTION_MAP[article.section];
  const isDeep = article.section === "deep";
  const av = article.author
    ? avatarOf(article.author)
    : { init: "??", bg: "var(--gray-100)", fg: "var(--gray-700)" };

  // 함께 읽기 — 같은 섹션의 다른 글 우선, 모자라면 반대 섹션에서 채운다.
  const [sameSection, otherSection, deckFile] = await Promise.all([
    getArticles({ section: article.section, limit: 4 }),
    getArticles({ section: isDeep ? "review" : "deep", limit: 3 }),
    isDeep ? getArticleAttachment(article.id) : Promise.resolve(null),
  ]);

  const related: RelatedItem[] = [...sameSection, ...otherSection]
    .filter((a) => a.id !== article.id)
    .slice(0, 3)
    .map((a) => ({
      href: routes.article(a),
      kicker: SECTION_MAP[a.section].ko,
      title: a.title,
      byline: `${a.author?.name ?? "미지정"} · ${a.published_at ? dotDate(a.published_at) : "미발행"}`,
    }));

  return (
    <div className={s.wrap}>
      <div className={s.paper}>
        <Link href={routes.section(article.section)} className={s.back}>
          ← {section.ko}
        </Link>

        <div className={s.head}>
          {!isPublished && (
            <div className={s.draftBadge}>임시저장 · 나에게만 보입니다</div>
          )}
          <div className={s.kicker}>
            {section.ko}
            {isDeep && article.talk_date
              ? ` · ${new Date(article.talk_date).getMonth() + 1}월 정기 발표`
              : ""}
          </div>
          <h1 className={s.title}>{article.title}</h1>
          {article.deck && <p className={s.deck}>{article.deck}</p>}
        </div>

        <div className={s.bylineBar}>
          <div className={s.byline}>
            <div className={s.avatar} style={{ background: av.bg, color: av.fg }}>
              {av.init}
            </div>
            <div>
              <div className={s.authorName}>
                {article.author?.name ?? "미지정"}
                {article.author && (
                  <span className={s.authorRole}> · {ROLE_LABEL[article.author.role]}</span>
                )}
              </div>
              <div className={s.publishedAt}>
                {article.published_at ? `${dotDate(article.published_at)} 발행` : "미발행"}
                {article.read_minutes ? ` · 읽는 데 ${article.read_minutes}분` : ""}
              </div>
            </div>
          </div>

          {canEdit && (
            <ArticleOwnerActions
              articleId={article.id}
              section={article.section}
              isDraft={!isPublished}
              commentCount={article.comments.length}
            />
          )}
        </div>

        <div className={s.contentGrid}>
          <div className={s.main}>
            {isDeep && (
              <figure className={s.figure}>
                <div className={s.figureBox}>
                  <PhotoSlot
                    src={storageUrl(article.photo_path)}
                    placeholder="발표 현장 사진을 올려주세요"
                    alt={`${article.title} 발표 현장`}
                  />
                </div>
                {article.talk_date && (
                  <figcaption className={s.figcaption}>
                    {shortDateKo(article.talk_date)} 정기 발표
                    {article.talk_room ? ` · ${article.talk_room}` : ""}
                  </figcaption>
                )}
              </figure>
            )}

            <ArticleBody blocks={article.body} />

            {isDeep && isPublished && (
              <CommentSection
                articleId={article.id}
                comments={article.comments}
                viewer={viewer.user}
              />
            )}
          </div>

          <aside className={s.aside}>
            <div className={s.asideSticky}>
              {article.sources.length > 0 && (
                <div className={s.card}>
                  <div className={s.cardTitle}>원문 소스</div>
                  <div className={s.sourceList}>
                    {article.sources.map((src) => {
                      const style = SRC[src.kind];
                      // 저장 시점에 http(s) 만 받지만, 그 검증이 붙기 전에
                      // 들어온 행이 있을 수 있어 렌더 직전에 한 번 더 거른다.
                      const href = safeHref(src.url);
                      if (!href) return null;
                      return (
                        <a
                          key={src.id}
                          href={href}
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
                          <span className={s.sourceLabel}>{src.label ?? src.url}</span>
                          <span className={s.sourceArrow}>↗</span>
                        </a>
                      );
                    })}
                  </div>
                </div>
              )}

              {deckFile && (
                <div className={s.deckCard}>
                  <div className={s.deckCardTitle}>발표 자료</div>
                  <div className={s.deckRow}>
                    <div className={s.pdfIcon}>PDF</div>
                    <div style={{ minWidth: 0 }}>
                      <div className={s.deckName}>{deckFile.file_name}</div>
                      <div className={s.deckMeta}>
                        {mb(deckFile.size_bytes, 1)} · 분할 업로드{" "}
                        {deckFile.received_chunks}/{deckFile.chunk_count} 완료
                      </div>
                    </div>
                  </div>
                  {storageUrl(deckFile.storage_path) && (
                    <a
                      href={storageUrl(deckFile.storage_path)!}
                      className={s.deckDownload}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      내려받기
                    </a>
                  )}
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
