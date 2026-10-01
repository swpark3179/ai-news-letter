import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";
import CategoryTabs from "@/components/section/CategoryTabs";
import DayGroups from "@/components/section/DayGroups";
import SearchBox from "@/components/section/SearchBox";
import s from "@/components/section/section.module.css";
import { CATEGORY_MAP, isCategoryKey } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { addDays, dotDate, isYmd } from "@/lib/format";
import {
  WINDOW_DAYS,
  getCategoryWindow,
  getLatestDate,
  searchCategory,
  windowStart,
} from "@/lib/data/feed";
import type { CategoryKey } from "@/types/db";

export const dynamic = "force-dynamic";

type Param = string | string[] | undefined;

interface Props {
  params: Promise<{ section: string }>;
  searchParams: Promise<{ q?: Param; until?: Param; filter?: Param }>;
}

/** 검색 결과로 보여 주는 최대 건수 */
const SEARCH_LIMIT = 100;

function first(v: Param): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/**
 * 예전 주소 — 트렌드 브리핑이 한 카테고리였고(?filter= 로 출처를 갈랐다), 주간 리뷰 ·
 * 딥다이브 섹션이 있던 시절의 북마크를 살린다.
 */
function redirectLegacy(section: string, filter: string | undefined): void {
  if (section === "trend") {
    const target: CategoryKey =
      filter === "hn" || filter === "arxiv" ? filter : filter === "geeknews" ? "geek" : "github";
    permanentRedirect(routes.category(target));
  }
  if (section === "review" || section === "deep") permanentRedirect(routes.home);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  if (!isCategoryKey(section)) return { title: "카테고리" };
  return { title: CATEGORY_MAP[section].ko };
}

/**
 * 카테고리 목록 — 수집한 날로 묶고 7일씩 넘긴다 (?until=YYYY-MM-DD).
 * ?q= 가 있으면 날짜 창을 무시하고 그 카테고리 전체에서 찾는다.
 */
export default async function SectionPage({ params, searchParams }: Props) {
  const { section } = await params;
  const sp = await searchParams;

  redirectLegacy(section, first(sp.filter));
  if (!isCategoryKey(section)) notFound();

  const def = CATEGORY_MAP[section];
  const q = (first(sp.q) ?? "").trim().slice(0, 100);

  return (
    <div className={s.wrap}>
      <div className={s.paper}>
        <div className={s.head}>
          <Link href={routes.home} className={s.back}>
            ← 1면으로
          </Link>
          <div className={s.headRow}>
            <div className={s.headText}>
              <h1 className={s.title}>{def.ko}</h1>
              <div className={s.note}>{def.note}</div>
            </div>
            <SearchBox
              action={routes.category(section)}
              q={q}
              placeholder={`${def.ko}에서 검색`}
            />
          </div>
          <CategoryTabs current={section} q={q || undefined} />
        </div>

        <div className={s.list}>
          {q ? (
            <SearchList category={section} q={q} />
          ) : (
            <WindowList category={section} until={first(sp.until)} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 7일 창                                                               */
/* ------------------------------------------------------------------ */

async function WindowList({ category, until: untilParam }: { category: CategoryKey; until?: string }) {
  const latest = await getLatestDate(category);

  if (!latest) {
    return <div className={s.empty}>아직 수집된 글이 없습니다.</div>;
  }

  // 주소창에서 온 값은 믿지 않는다 — 날짜가 아니거나 마지막 수집일보다 늦으면 최근 창으로.
  const until = isYmd(untilParam) && untilParam < latest ? untilParam : latest;
  const from = windowStart(until);

  const [items, older] = await Promise.all([
    getCategoryWindow(category, from, until),
    // 다음 창은 「빈 주」를 건너뛰고 그보다 앞서 수집된 날부터 시작한다.
    getLatestDate(category, from),
  ]);

  const newerUntil = until < latest ? addDays(until, WINDOW_DAYS) : null;
  const newerHref =
    newerUntil === null
      ? null
      : routes.category(category, newerUntil >= latest ? {} : { until: newerUntil });

  return (
    <>
      <div className={s.summary}>
        <span className={s.summaryRange}>
          {dotDate(from)} – {dotDate(until)}
        </span>
        <span>
          {until === latest ? "최근 7일" : "7일"} · {items.length}건
        </span>
      </div>

      {items.length === 0 ? (
        <div className={s.empty}>이 기간에 수집된 글이 없습니다.</div>
      ) : (
        <DayGroups items={items} />
      )}

      <Pager
        newer={newerHref}
        older={older ? routes.category(category, { until: older }) : null}
      />
    </>
  );
}

function Pager({ newer, older }: { newer: string | null; older: string | null }) {
  if (!newer && !older) return null;
  return (
    <nav className={s.pager} aria-label="기간 이동">
      {newer ? (
        <Link href={newer} className={s.pagerLink}>
          ← 더 최근 7일
        </Link>
      ) : (
        <span />
      )}
      {older ? (
        <Link href={older} className={s.pagerLink}>
          더 이전 7일 →
        </Link>
      ) : (
        <span className={s.pagerEnd}>첫 수집일까지 모두 봤습니다</span>
      )}
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* 검색                                                                 */
/* ------------------------------------------------------------------ */

async function SearchList({ category, q }: { category: CategoryKey; q: string }) {
  const { items, total } = await searchCategory(category, q, SEARCH_LIMIT);

  return (
    <>
      <div className={s.summary}>
        <span className={s.summaryRange}>‘{q}’</span>
        <span>
          검색 결과 {total}건
          {total > items.length ? ` · 최근 ${items.length}건만 보여 줍니다` : ""}
        </span>
        <span className={s.summaryActions}>
          <Link href={routes.search(q)} className={s.summaryLink}>
            모든 카테고리에서 찾기
          </Link>
          <Link href={routes.category(category)} className={s.summaryLink}>
            검색 지우기
          </Link>
        </span>
      </div>

      {items.length === 0 ? (
        <div className={s.empty}>
          ‘{q}’ 가 들어간 글이 없습니다.
          <div className={s.emptyHint}>낱말을 줄이거나 다른 카테고리에서 찾아보세요.</div>
        </div>
      ) : (
        <DayGroups items={items} />
      )}
    </>
  );
}
