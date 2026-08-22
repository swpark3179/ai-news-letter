import Link from "next/link";
import PhotoSlot from "@/components/ui/PhotoSlot";
import { ROLE_LABEL, avatarOf } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { shortDateKo } from "@/lib/format";
import type { ArticleWithAuthor } from "@/types/db";
import s from "./home.module.css";

interface Props {
  deep: ArticleWithAuthor | null;
  commentCount: number;
  photoUrl: string | null;
  showEn: boolean;
}

/** 심층 분석 블록 (디자인 310~339행) */
export default function DeepDive({ deep, commentCount, photoUrl, showEn }: Props) {
  return (
    <div className={s.deepBlock}>
      <div className={s.blockHead}>
        <span className={s.blockTitle}>심층 분석</span>
        {showEn && <span className={s.blockEn}>Deep Dive</span>}
        <span className={s.blockNote}>
          매월 한 명씩 돌아가며 발표하고, 발표 내용을 기사로 남깁니다
        </span>
        <Link href={routes.meetings} className={s.blockLink}>
          모임 아카이브 →
        </Link>
      </div>

      {!deep ? (
        <div className={s.emptyBlock}>
          아직 발행된 심층 분석 기사가 없습니다.
          <div className={s.emptyHint}>관리자 → 글 작성 → 심층 분석</div>
        </div>
      ) : (
        <div className={s.deepGrid}>
          <div className={s.deepPhoto}>
            <PhotoSlot src={photoUrl} placeholder="정기 발표 현장 사진" />
          </div>

          <div>
            <div className={s.deepBadgeRow}>
              <span className={s.deepBadge}>
                {deep.talk_date
                  ? `${new Date(deep.talk_date).getMonth() + 1}월 정기 발표`
                  : "정기 발표"}
              </span>
              <span className={s.deepMeta}>
                {deep.talk_date ? shortDateKo(deep.talk_date) : "일정 미정"}
                {deep.talk_room ? ` · ${deep.talk_room}` : ""}
              </span>
            </div>

            <Link href={routes.article(deep)} className={s.deepTitle}>
              <h2 style={{ font: "inherit", letterSpacing: "inherit", margin: 0 }}>
                {deep.title}
              </h2>
            </Link>

            {deep.deck && <p className={s.deepDeck}>{deep.deck}</p>}

            <div className={s.deepByline}>
              {deep.author && (
                <>
                  <div
                    className={s.deepAvatar}
                    style={{
                      background: avatarOf(deep.author).bg,
                      color: avatarOf(deep.author).fg,
                    }}
                  >
                    {avatarOf(deep.author).init}
                  </div>
                  <div>
                    <div className={s.deepAuthor}>
                      {deep.author.name}{" "}
                      <span className={s.deepAuthorRole}>
                        · {ROLE_LABEL[deep.author.role]}
                      </span>
                    </div>
                    <div className={s.deepSub}>
                      읽는 데 {deep.read_minutes ?? 10}분 · 토론 코멘트 {commentCount}
                    </div>
                  </div>
                </>
              )}
              <Link href={routes.article(deep)} className={s.deepCta}>
                분석 기사 읽기
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
