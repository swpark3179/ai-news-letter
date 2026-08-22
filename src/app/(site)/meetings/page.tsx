import Link from "next/link";
import type { Metadata } from "next";
import PhotoSlot from "@/components/ui/PhotoSlot";
import s from "@/components/meetings/meetings.module.css";
import { ROLE_LABEL, avatarOf } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { shortDateKo } from "@/lib/format";
import { getMeetings, getRotations } from "@/lib/data/content";
import { storageUrl } from "@/lib/data/ops";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "모임 아카이브" };

const ROTATION_STATUS: Record<string, { label: string; fg: string }> = {
  done: { label: "발표 완료", fg: "var(--green-700)" },
  preparing: { label: "준비 중", fg: "var(--purple-700)" },
  reviewing: { label: "검토 중", fg: "var(--yellow-800)" },
  planned: { label: "예정", fg: "var(--gray-400)" },
};

export default async function MeetingsPage() {
  const [meetings, rotation] = await Promise.all([
    getMeetings(12),
    getRotations("deep", 8),
  ]);

  const next = rotation.find((r) => r.status !== "done");

  return (
    <div className={s.wrap}>
      <div className={s.paper}>
        <Link href={routes.home} className={s.back}>
          ← 1면으로
        </Link>

        <div className={s.head}>
          <div>
            <div className={s.title}>모임 아카이브</div>
            <div className={s.note}>
              매주 정기 모임 · 한 주간 올라온 요약을 토론하고 다음 주 리뷰 주제를 정합니다
            </div>
          </div>
          {next && (
            <div className={s.nextWrap}>
              <div className={s.nextLabel}>다음 발표</div>
              <div className={s.nextValue}>
                {next.period_label} · {next.member?.name ?? "미지정"}
              </div>
            </div>
          )}
        </div>

        <div className={s.grid}>
          <div className={s.list}>
            {meetings.length === 0 && (
              <div className={s.empty}>아직 기록된 모임이 없습니다.</div>
            )}

            {meetings.map((m) => (
              <div key={m.id} className={s.meeting}>
                <div>
                  <div className={s.week}>{m.week_label}</div>
                  <div className={s.date}>{shortDateKo(m.met_at)}</div>
                  {m.room && <div className={s.room}>{m.room}</div>}
                  <div className={s.people}>
                    {m.attendees.map((p) => {
                      const av = avatarOf(p);
                      return (
                        <div
                          key={p.id}
                          className={s.person}
                          style={{ background: av.bg, color: av.fg }}
                          title={p.name}
                        >
                          {av.init}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className={s.topicsLabel}>토론한 요약 게시물</div>
                  <div className={s.topics}>
                    {m.topics.map((t, i) => (
                      <div key={i} className={s.topic}>
                        <span className={s.topicDot} />
                        <span className={s.topicText}>{t}</span>
                      </div>
                    ))}
                  </div>

                  {m.talk_title && (
                    <div className={s.talkBox}>
                      <div className={s.talkPhoto}>
                        <PhotoSlot
                          src={storageUrl(m.photo_path)}
                          placeholder="발표 사진"
                          rounded
                        />
                      </div>
                      <div>
                        <div className={s.talkBadgeRow}>
                          <span className={s.talkBadge}>심층 발표</span>
                          {m.presenter && (
                            <span className={s.talkPresenter}>
                              {m.presenter.name} · {ROLE_LABEL[m.presenter.role]}
                            </span>
                          )}
                        </div>
                        {m.article_id ? (
                          <Link
                            href={routes.article({ id: m.article_id })}
                            className={s.talkTitle}
                          >
                            {m.talk_title}
                          </Link>
                        ) : (
                          <div className={s.talkTitle}>{m.talk_title}</div>
                        )}
                        <div className={s.talkMeta}>
                          <span>Q&amp;A {m.qa_count}건</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <aside>
            <div className={s.rotationCard}>
              <div className={s.rotationTitle}>발표 순번</div>
              <div className={s.rotationList}>
                {rotation.map((r) => {
                  const av = r.member
                    ? avatarOf(r.member)
                    : { init: "??", bg: "var(--gray-100)", fg: "var(--gray-700)" };
                  const st = ROTATION_STATUS[r.status] ?? ROTATION_STATUS.planned;
                  const isNext = next?.id === r.id;
                  return (
                    <div
                      key={r.id}
                      className={`${s.rotationRow} ${isNext ? s.rotationRowNext : ""}`}
                    >
                      <div
                        className={s.rotationAvatar}
                        style={{ background: av.bg, color: av.fg }}
                      >
                        {av.init}
                      </div>
                      <div>
                        <div className={s.rotationName}>{r.member?.name ?? "미지정"}</div>
                        <div className={s.rotationPeriod}>{r.period_label}</div>
                      </div>
                      <span className={s.rotationStatus} style={{ color: st.fg }}>
                        {st.label}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className={s.rotationNote}>
                주간 리뷰는 전원이 매주 1건씩, 심층 분석 발표는 4주 주기로 한 명씩 돌아갑니다.
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
