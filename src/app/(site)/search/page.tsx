import Link from "next/link";
import type { Metadata } from "next";
import ItemRow from "@/components/section/ItemRow";
import SearchBox from "@/components/section/SearchBox";
import s from "@/components/section/section.module.css";
import { CATEGORIES } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { searchAll } from "@/lib/data/feed";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ q?: string | string[] }>;
}

/** 카테고리마다 먼저 보여 주는 건수. 나머지는 그 카테고리 목록의 검색으로 넘긴다. */
const PER_CATEGORY = 5;

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  const term = (Array.isArray(q) ? q[0] : q)?.trim();
  return { title: term ? `‘${term}’ 검색` : "검색" };
}

/**
 * 다섯 카테고리를 한 번에 찾는다. 앱의 검색이 mobile_feed 만 보는 것과 달리 쇼케이스
 * (mobile_showcase)까지 본다 — 웹은 카테고리 탭이 다섯 개라 결과도 다섯 갈래로 나눈다.
 */
export default async function SearchPage({ searchParams }: Props) {
  const raw = (await searchParams).q;
  const q = ((Array.isArray(raw) ? raw[0] : raw) ?? "").trim().slice(0, 100);

  return (
    <div className={s.wrap}>
      <div className={s.paper}>
        <div className={s.head}>
          <Link href={routes.home} className={s.back}>
            ← 1면으로
          </Link>
          <div className={s.headRow}>
            <div className={s.headText}>
              <h1 className={s.title}>검색</h1>
              <div className={s.note}>
                긱뉴스 · 쇼케이스 · GitHub · Hacker News · arXiv 의 제목과 요약에서 찾습니다.
                낱말을 띄어 쓰면 모두 들어 있는 글만 나옵니다.
              </div>
            </div>
            <SearchBox action={routes.search()} q={q} placeholder="찾을 낱말" />
          </div>
        </div>

        <div className={s.list}>
          {q ? <Results q={q} /> : <div className={s.empty}>찾을 낱말을 입력하세요.</div>}
        </div>
      </div>
    </div>
  );
}

async function Results({ q }: { q: string }) {
  const results = await searchAll(q, PER_CATEGORY);
  const total = CATEGORIES.reduce((n, c) => n + results[c.key].total, 0);

  if (total === 0) {
    return (
      <div className={s.empty}>
        ‘{q}’ 가 들어간 글이 없습니다.
        <div className={s.emptyHint}>낱말을 줄이거나 다르게 써 보세요.</div>
      </div>
    );
  }

  return (
    <>
      <div className={s.summary}>
        <span className={s.summaryRange}>‘{q}’</span>
        <span>모두 {total}건</span>
        <span className={s.summaryActions}>
          {CATEGORIES.filter((c) => results[c.key].total > 0).map((c) => (
            <a key={c.key} href={`#${c.key}`} className={s.summaryLink}>
              {c.ko} {results[c.key].total}
            </a>
          ))}
        </span>
      </div>

      {CATEGORIES.map((c) => {
        const r = results[c.key];
        if (r.total === 0) return null;
        return (
          <section key={c.key} id={c.key} className={s.day} aria-label={c.ko}>
            <h2 className={s.dayHead}>
              <span className={s.dayDate}>{c.ko}</span>
              <span className={s.dayCount}>{r.total}건</span>
            </h2>
            {r.items.map((item, i) => (
              <ItemRow key={item.key} item={item} index={i} withCategory />
            ))}
            {r.total > r.items.length && (
              <Link href={routes.category(c.key, { q })} className={s.moreLink}>
                {c.ko}에서 {r.total}건 모두 보기 →
              </Link>
            )}
          </section>
        );
      })}
    </>
  );
}
