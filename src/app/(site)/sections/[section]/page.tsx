import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  ROLE_LABEL,
  SECTION_MAP,
  SRC,
  TREND_SOURCE_TO_KIND,
  isSectionKey,
  sourceStyleOf,
} from "@/lib/domain";
import { routes } from "@/lib/routes";
import { issueNum, shortDot } from "@/lib/format";
import {
  getArticles,
  getGeekNews,
  getMyDraft,
  getTrendItems,
} from "@/lib/data/content";
import { getSessionUser } from "@/lib/auth/current-user";
import type { SessionUser } from "@/lib/auth/session";
import type { SectionKey, TrendSource, WritableSection } from "@/types/db";
import s from "@/components/section/section.module.css";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ filter?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  if (!isSectionKey(section)) return { title: "카테고리" };
  return { title: SECTION_MAP[section].ko };
}

const TREND_FILTERS: { label: string; value: string }[] = [
  { label: "전체", value: "all" },
  { label: "GitHub Trending", value: "github" },
  { label: "Hacker News", value: "hn" },
  { label: "arXiv", value: "arxiv" },
  { label: "긱뉴스", value: "geeknews" },
];

export default async function SectionPage({ params, searchParams }: Props) {
  const { section } = await params;
  const { filter = "all" } = await searchParams;

  if (!isSectionKey(section)) notFound();
  const def = SECTION_MAP[section as SectionKey];

  // 위클리 리뷰 · 심층 분석은 유닛원이 직접 쓰는 카테고리라 등록 진입점이 붙는다.
  const writable: WritableSection | null =
    section === "review" || section === "deep" ? section : null;
  const user = writable ? await getSessionUser() : null;
  const mine = writable !== null && filter === "mine";

  // 이어쓸 임시저장 — "내 글" 목록에는 이미 보이므로 그때는 배너를 숨긴다.
  const draft =
    writable && user && !mine ? await getMyDraft(user.id, writable) : null;

  return (
    <div className={s.wrap}>
      <div className={s.paper}>
        <div className={s.head}>
          <Link href={routes.home} className={s.back}>
            ← 1면으로
          </Link>
          <div className={s.headRow}>
            <div>
              <div className={s.title}>{def.ko}</div>
              <div className={s.note}>{def.note}</div>
            </div>

            {section === "trend" && (
              <div className={s.filters}>
                {TREND_FILTERS.map((f) => (
                  <Link
                    key={f.value}
                    href={routes.section("trend", f.value)}
                    className={`${s.filter} ${filter === f.value ? s.filterOn : ""}`}
                  >
                    {f.label}
                  </Link>
                ))}
              </div>
            )}

            {writable && user && (
              <div className={s.actions}>
                <Link
                  href={routes.section(writable, "all")}
                  className={`${s.filter} ${mine ? "" : s.filterOn}`}
                >
                  전체
                </Link>
                <Link
                  href={routes.section(writable, "mine")}
                  className={`${s.filter} ${mine ? s.filterOn : ""}`}
                >
                  내 글
                </Link>
                <Link href={routes.sectionWrite(writable)} className={s.writeBtn}>
                  ＋ 글 쓰기
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className={s.list}>
          {draft && (
            <div className={s.draftBanner}>
              작성 중인 글이 있습니다 ·
              <span className={s.draftBannerTitle}>{draft.title || "제목 없음"}</span>
              <Link href={routes.sectionWrite(draft.section)} className={s.draftBannerLink}>
                이어쓰기
              </Link>
            </div>
          )}

          {section === "geek" && <GeekList />}
          {section === "trend" && <TrendList filter={filter} />}
          {writable && (
            <ArticleList
              section={writable}
              viewer={user}
              mine={mine}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 긱뉴스 — 제목을 누르면 긱뉴스 원문으로 바로 이동 (상세 페이지 없음)   */
/* ------------------------------------------------------------------ */

async function GeekList() {
  const rows = await getGeekNews(60);

  if (rows.length === 0) {
    return (
      <div className={s.empty}>
        아직 수집된 긱뉴스가 없습니다.
        <div className={s.emptyHint}>npm run sync:geeknews</div>
      </div>
    );
  }

  return (
    <>
      {rows.map((g) => (
        <a
          key={g.url}
          href={g.url}
          target="_blank"
          rel="noreferrer noopener"
          className={s.row}
        >
          <div>
            <div className={s.rowDate}>{shortDot(g.published_at)}</div>
            <div className={s.rowNum}>NO.{issueNum(g.published_at)}</div>
          </div>
          <div>
            <div className={s.rowKicker}>긱뉴스</div>
            <div className={s.rowTitle}>{g.title}</div>
            <div className={s.rowDeck}>{g.summary}</div>
            <div className={s.rowTags}>
              {g.source_domain && <span className={s.tag}>{g.source_domain}</span>}
              {g.submitter && <span className={s.tag}>@{g.submitter}</span>}
            </div>
          </div>
          <div className={s.rowRight}>
            <span
              className={s.badge}
              style={{ background: SRC.gk.bg, color: SRC.gk.fg }}
            >
              {SRC.gk.tag}
            </span>
            <div className={s.rowMeta}>
              {g.points} points · 댓글 {g.comment_count}
            </div>
          </div>
        </a>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 트렌드 브리핑                                                        */
/* ------------------------------------------------------------------ */

async function TrendList({ filter }: { filter: string }) {
  const source =
    filter !== "all" && ["github", "hn", "arxiv", "geeknews"].includes(filter)
      ? (filter as TrendSource)
      : undefined;

  const rows = await getTrendItems({ source, limit: 80 });

  if (rows.length === 0) {
    return (
      <div className={s.empty}>
        {source
          ? "이 출처에서 수집된 항목이 없습니다."
          : "아직 수집된 트렌드 브리핑이 없습니다."}
        <div className={s.emptyHint}>npm run sync:trend</div>
      </div>
    );
  }

  return (
    <>
      {rows.map((t) => {
        const style = sourceStyleOf(t.source);
        return (
          <Link key={t.source_url} href={routes.trend(t)} className={s.row}>
            <div>
              <div className={s.rowDate}>{shortDot(t.collected_date)}</div>
              <div className={s.rowNum}>NO.{issueNum(t.collected_date)}</div>
            </div>
            <div>
              <div className={s.rowKicker}>
                트렌드 브리핑 · {SRC[TREND_SOURCE_TO_KIND[t.source]].label}
                {t.source_variant ? ` (${t.source_variant})` : ""}
              </div>
              <div className={s.rowTitle}>{t.title}</div>
              {t.deck && <div className={s.rowDeck}>{t.deck}</div>}
              <div className={s.rowTags}>
                {t.tags.map((tag) => (
                  <span key={tag} className={s.tag}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>
            <div className={s.rowRight}>
              <span
                className={s.badge}
                style={{ background: style.bg, color: style.fg }}
              >
                {style.tag}
              </span>
              <div className={s.rowMeta}>
                {t.llm_provider ? `${t.llm_provider} 요약` : "자동 요약"}
              </div>
            </div>
          </Link>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* 위클리 리뷰 / 심층 분석                                              */
/* ------------------------------------------------------------------ */

async function ArticleList({
  section,
  viewer,
  mine,
}: {
  section: "review" | "deep";
  viewer: SessionUser | null;
  mine: boolean;
}) {
  // "내 글" 은 임시저장까지 보여 준다 — 여기서 수정·삭제로 넘어간다.
  const rows =
    mine && viewer
      ? await getArticles({
          section,
          authorId: viewer.id,
          includeDrafts: true,
          limit: 60,
        })
      : await getArticles({ section, limit: 60 });

  if (rows.length === 0) {
    return (
      <div className={s.empty}>
        {mine ? "아직 작성한 글이 없습니다." : "아직 발행된 글이 없습니다."}
        <div className={s.emptyHint}>
          {viewer ? "오른쪽 위 ＋ 글 쓰기 로 등록하세요" : "로그인하면 글을 쓸 수 있습니다"}
        </div>
      </div>
    );
  }

  return (
    <>
      {rows.map((a) => (
        <Link key={a.id} href={routes.article(a)} className={s.row}>
          <div>
            <div className={s.rowDate}>
              {a.published_at ? shortDot(a.published_at) : "—"}
            </div>
            <div className={s.rowNum}>
              NO.{a.published_at ? issueNum(a.published_at) : "----"}
            </div>
          </div>
          <div>
            <div className={s.rowKicker}>
              {SECTION_MAP[section].ko}
              {a.status !== "published" && (
                <> · <span className={s.draftTag}>임시저장</span></>
              )}
            </div>
            <div className={s.rowTitle}>{a.title}</div>
            {a.deck && <div className={s.rowDeck}>{a.deck}</div>}
            <div className={s.rowTags}>
              {a.tags.map((tag) => (
                <span key={tag} className={s.tag}>
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className={s.rowRight}>
            <div className={s.rowAuthor}>{a.author?.name ?? "미지정"}</div>
            <div className={s.rowMeta}>
              {a.author ? ROLE_LABEL[a.author.role] : ""}
              {section === "deep" ? " · 발표 자료 포함" : " · 유닛 기고"}
            </div>
          </div>
        </Link>
      ))}
    </>
  );
}
