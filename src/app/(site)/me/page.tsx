import Link from "next/link";
import type { Metadata } from "next";
import ScrapButton from "@/components/scrap/ScrapButton";
import s from "@/components/section/section.module.css";
import { SRC, TREND_SOURCE_TO_KIND, sourceStyleOf } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { shortDot } from "@/lib/format";
import { getViewer } from "@/lib/auth/current-user";
import {
  countMyScraps,
  getMyScraps,
  isSavableType,
  type SavedEntry,
} from "@/lib/data/scraps";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "내 보관함" };

interface Props {
  searchParams: Promise<{ filter?: string }>;
}

/**
 * 내 보관함.
 *
 * 헤더의 아바타·보관함 버튼이 들어오는 곳이다. 조회는 항상 자기 member_id 로만
 * 걸리므로 다른 사람이 무엇을 담았는지는 이 화면에 나오지 않는다. 전체 집계는
 * 관리자 화면(/admin/scraps)에서만 본다.
 */
export default async function SavedPage({ searchParams }: Props) {
  const { filter = "all" } = await searchParams;
  const { user } = await getViewer();

  const type = isSavableType(filter) ? filter : undefined;

  const [entries, counts] = user
    ? await Promise.all([
        getMyScraps(user.id, { type, limit: 120 }),
        countMyScraps(user.id),
      ])
    : [[], { total: 0, geek: 0, trend: 0 }];

  const tabs = [
    { label: `전체 ${counts.total}`, value: "all" },
    { label: `긱뉴스 ${counts.geek}`, value: "geek" },
    { label: `트렌드 브리핑 ${counts.trend}`, value: "trend" },
  ] as const;

  return (
    <div className={s.wrap}>
      <div className={s.paper}>
        <div className={s.head}>
          <Link href={routes.home} className={s.back}>
            ← 1면으로
          </Link>
          <div className={s.headRow}>
            <div>
              <div className={s.title}>내 보관함</div>
              <div className={s.note}>
                {user
                  ? `${user.name} 님이 담아 둔 게시물 · 나에게만 보입니다`
                  : "게시물을 담아 두면 여기 모입니다 · 나에게만 보입니다"}
              </div>
            </div>

            {user && (
              <div className={s.filters}>
                {tabs.map((t) => (
                  <Link
                    key={t.value}
                    href={routes.saved(t.value)}
                    className={`${s.filter} ${
                      (t.value === "all" ? !type : type === t.value) ? s.filterOn : ""
                    }`}
                  >
                    {t.label}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className={s.list}>
          {!user ? (
            <div className={s.notice}>
              보관함은 로그인한 뒤에 쓸 수 있습니다.
              <Link href={routes.login} className={s.noticeLink}>
                로그인
              </Link>
            </div>
          ) : entries.length === 0 ? (
            <div className={s.empty}>
              {type ? "이 카테고리에 담아 둔 게시물이 없습니다." : "아직 담아 둔 게시물이 없습니다."}
              <div className={s.emptyHint}>
                긱뉴스·트렌드 브리핑 목록의 <strong>보관</strong> 버튼을 누르면 이곳에
                모입니다
              </div>
            </div>
          ) : (
            entries.map((e) => <SavedRow key={`${e.targetType} ${e.targetKey}`} entry={e} />)
          )}
        </div>
      </div>
    </div>
  );
}

function SavedRow({ entry }: { entry: SavedEntry }) {
  const { geek, trend } = entry;

  // 종류별로 제목 링크와 오른쪽 메타가 다르다.
  const view = geek
    ? {
        kicker: "긱뉴스",
        title: geek.title,
        deck: geek.summary,
        href: geek.url,
        external: true,
        badge: SRC.gk,
        meta: `${geek.points} points · 댓글 ${geek.comment_count}`,
        tags: [geek.source_domain].filter((t): t is string => !!t),
      }
    : trend
      ? {
          kicker: `트렌드 브리핑 · ${SRC[TREND_SOURCE_TO_KIND[trend.source]].label}${
            trend.source_variant ? ` (${trend.source_variant})` : ""
          }`,
          title: trend.title,
          deck: trend.deck,
          href: routes.trend(trend),
          external: false,
          badge: sourceStyleOf(trend.source),
          meta: trend.llm_provider ? `${trend.llm_provider} 요약` : "자동 요약",
          tags: trend.tags,
        }
      : null;

  return (
    <div className={s.row}>
      <div>
        <div className={s.rowDate}>{shortDot(entry.savedAt)}</div>
        <div className={s.rowSaved}>보관</div>
      </div>

      <div>
        {view ? (
          <>
            <div className={s.rowKicker}>{view.kicker}</div>
            {view.external ? (
              <a
                href={view.href}
                target="_blank"
                rel="noreferrer noopener"
                className={s.rowTitleLink}
              >
                <span className={s.rowTitle}>{view.title}</span>
              </a>
            ) : (
              <Link href={view.href} className={s.rowTitleLink}>
                <span className={s.rowTitle}>{view.title}</span>
              </Link>
            )}
            {view.deck && <div className={s.rowDeck}>{view.deck}</div>}
            {view.tags.length > 0 && (
              <div className={s.rowTags}>
                {view.tags.map((t) => (
                  <span key={t} className={s.tag}>
                    {t}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className={s.rowKicker}>
              {entry.targetType === "geek" ? "긱뉴스" : "트렌드 브리핑"}
            </div>
            <div className={s.rowGone}>지워졌거나 숨겨진 게시물입니다</div>
            <div className={s.rowTags}>
              <span className={s.tag}>{entry.targetKey}</span>
            </div>
          </>
        )}
      </div>

      <div className={s.rowRight}>
        {view && (
          <>
            <span
              className={s.badge}
              style={{ background: view.badge.bg, color: view.badge.fg }}
            >
              {view.badge.tag}
            </span>
            <div className={s.rowMeta}>{view.meta}</div>
          </>
        )}
        {(entry.targetType === "geek" || entry.targetType === "trend") && (
          <ScrapButton
            targetType={entry.targetType}
            targetKey={entry.targetKey}
            initialSaved
            refreshOnChange
          />
        )}
      </div>
    </div>
  );
}
