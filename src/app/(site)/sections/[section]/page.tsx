import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  SECTION_MAP,
  SRC,
  TREND_SOURCE_TO_KIND,
  isSectionKey,
  sourceStyleOf,
} from "@/lib/domain";
import { routes } from "@/lib/routes";
import { issueNum, shortDot } from "@/lib/format";
import { getFeed } from "@/lib/data/feed";
import type { SectionKey, TrendSource } from "@/types/db";
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
          </div>
        </div>

        <div className={s.list}>
          {section === "geek" && <GeekList />}
          {section === "trend" && <TrendList filter={filter} />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 긱뉴스 — 제목을 누르면 긱뉴스 원문으로 바로 이동 (상세 페이지 없음)   */
/* ------------------------------------------------------------------ */

async function GeekList() {
  const rows = await getFeed({ type: "geek", limit: 60 });

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
        <div key={g.key} className={s.row}>
          <div>
            <div className={s.rowDate}>{shortDot(g.published_at)}</div>
            <div className={s.rowNum}>NO.{issueNum(g.published_at)}</div>
          </div>
          <div>
            <div className={s.rowKicker}>긱뉴스</div>
            <a
              href={g.open_url}
              target="_blank"
              rel="noreferrer noopener"
              className={s.rowTitleLink}
            >
              <span className={s.rowTitle}>{g.title}</span>
            </a>
            <div className={s.rowDeck}>{g.lede}</div>
            <div className={s.rowTags}>
              {g.host && <span className={s.tag}>{g.host}</span>}
              {g.origin_url && (
                <a
                  href={g.origin_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className={s.tag}
                >
                  원문 ↗
                </a>
              )}
            </div>
          </div>
          <div className={s.rowRight}>
            <span
              className={s.badge}
              style={{ background: SRC.gk.bg, color: SRC.gk.fg }}
            >
              {SRC.gk.tag}
            </span>
            <div className={s.rowMeta}>{g.meta}</div>
          </div>
        </div>
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

  const rows = await getFeed({ type: "trend", source, limit: 80 });

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
        // mobile_feed 의 트렌드 행은 source 가 항상 있다.
        const src = t.source ?? "github";
        const style = sourceStyleOf(src);
        // 저장소 이름이 있으면 그것이 제목이고 AI 제목이 바로 아래 설명 줄이 된다.
        const repo = t.repo;
        return (
          <div key={t.key} className={s.row}>
            <div>
              <div className={s.rowDate}>{shortDot(t.collected_date)}</div>
              <div className={s.rowNum}>수집</div>
            </div>
            <div>
              <div className={s.rowKicker}>
                트렌드 브리핑 · {SRC[TREND_SOURCE_TO_KIND[src]].label}
                {t.source_variant ? ` (${t.source_variant})` : ""}
              </div>
              <Link href={routes.trend(t)} className={s.rowTitleLink}>
                <span className={repo ? s.rowRepo : s.rowTitle}>
                  {repo ?? t.title}
                </span>
              </Link>
              {repo && <div className={s.rowLede}>{t.title}</div>}
              {t.lede && <div className={s.rowDeck}>{t.lede}</div>}
            </div>
            <div className={s.rowRight}>
              <span
                className={s.badge}
                style={{ background: style.bg, color: style.fg }}
              >
                {style.tag}
              </span>
              <div className={s.rowMeta}>{t.meta || "자동 요약"}</div>
            </div>
          </div>
        );
      })}
    </>
  );
}
