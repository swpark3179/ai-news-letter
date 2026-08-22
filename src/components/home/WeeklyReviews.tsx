import Link from "next/link";
import { ROLE_LABEL, avatarOf } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { shortDot } from "@/lib/format";
import type { ArticleWithAuthor } from "@/types/db";
import s from "./home.module.css";

interface Props {
  reviews: ArticleWithAuthor[];
  /** 카드로 보여준 것 외에 더 있는 건수 */
  restCount: number;
  showEn: boolean;
}

/** 위클리 리뷰 카드 (디자인 343~371행) */
export default function WeeklyReviews({ reviews, restCount, showEn }: Props) {
  return (
    <div className={s.reviewBlock}>
      <div className={s.blockHead}>
        <span className={s.blockTitle}>위클리 리뷰</span>
        {showEn && <span className={s.blockEn}>Weekly Review</span>}
        <span className={s.blockNote}>유닛원이 매주 하나씩 고른 저장소 · 스레드 · 논문</span>
        {restCount > 0 && (
          <span className={s.reviewCountBadge}>＋{restCount}건 더</span>
        )}
        <Link href={routes.section("review")} className={s.blockLink}>
          전체 보기 →
        </Link>
      </div>

      {reviews.length === 0 ? (
        <div className={s.emptyBlock}>
          아직 발행된 위클리 리뷰가 없습니다.
          <div className={s.emptyHint}>관리자 → 글 작성 → 위클리 리뷰</div>
        </div>
      ) : (
        <div className={s.reviewGrid}>
          {reviews.map((r) => {
            const av = r.author
              ? avatarOf(r.author)
              : { init: "??", bg: "var(--gray-100)", fg: "var(--gray-700)" };
            return (
              <Link key={r.id} href={routes.article(r)} className={s.reviewCard}>
                <div className={s.reviewTop}>
                  <div
                    className={s.reviewAvatar}
                    style={{ background: av.bg, color: av.fg }}
                  >
                    {av.init}
                  </div>
                  <span className={s.reviewAuthor}>{r.author?.name ?? "미지정"}</span>
                  <span className={s.reviewDate}>
                    {r.published_at ? shortDot(r.published_at) : "미발행"}
                  </span>
                </div>

                {r.repo_label && <div className={s.reviewRepo}>{r.repo_label}</div>}
                <div className={s.reviewTitle}>{r.title}</div>
                {r.deck && <div className={s.reviewDeck}>{r.deck}</div>}

                <div className={s.reviewFoot}>
                  {r.tags[0] && <span className={s.reviewTag}>{r.tags[0]}</span>}
                  <span className={s.reviewRole}>
                    {r.author ? ROLE_LABEL[r.author.role] : ""}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
