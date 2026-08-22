"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AVATAR_TONES } from "@/lib/domain";
import { shortDateKo } from "@/lib/format";
import type { AvatarTone, CommentRow } from "@/types/db";
import type { SessionUser } from "@/lib/auth/session";
import s from "./article.module.css";

interface Props {
  articleId: string;
  comments: CommentRow[];
  viewer: SessionUser | null;
}

const MAX = 1000;

function tagStyle(roleTag: string) {
  const reader = roleTag === "구독자";
  return {
    background: reader ? "var(--gray-100)" : "var(--purple-50)",
    color: reader ? "var(--gray-700)" : "var(--purple-700)",
  };
}

/** 심층 분석 토론 코멘트 (디자인 487~525행) */
export default function CommentSection({ articleId, comments, viewer }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = draft.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ articleId, body: draft.trim() }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "코멘트 등록에 실패했습니다.");
      }
      setDraft("");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "코멘트 등록에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const meTone =
    AVATAR_TONES[(viewer?.avatarTone as AvatarTone) ?? "gray"] ?? AVATAR_TONES.gray;

  return (
    <div className={s.comments}>
      <div className={s.commentsHead}>
        <div className={s.commentsTitle}>
          토론 코멘트 <span className={s.commentsCount}>{comments.length}</span>
        </div>
        <div className={s.commentsNote}>
          심층 분석 기사에는 구독자 누구나 질문과 의견을 남길 수 있습니다
        </div>
      </div>

      {viewer ? (
        <div className={s.composer}>
          <div
            className={s.composerAvatar}
            style={{ background: meTone.bg, color: meTone.fg }}
          >
            {viewer.initial ?? viewer.name.slice(-2)}
          </div>
          <div className={s.composerBox}>
            <div className={s.composerHead}>
              <span className={s.composerName}>{viewer.name}</span>
              <span
                className={s.roleTag}
                style={tagStyle(viewer.role === "subscriber" ? "구독자" : "유닛원")}
              >
                {viewer.role === "subscriber" ? "구독자" : "유닛원"}
              </span>
            </div>
            <textarea
              className={s.composerInput}
              rows={3}
              maxLength={MAX}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="발표 내용에 대한 질문이나 의견을 남겨 주세요"
            />
            <div className={s.composerFoot}>
              <span className={s.composerCount}>
                {draft.length} / {MAX}
              </span>
              <button
                type="button"
                className={`${s.composerSubmit} ${canSubmit ? s.composerSubmitOn : ""}`}
                onClick={() => void submit()}
                disabled={!canSubmit}
              >
                {busy ? "등록 중…" : "코멘트 등록"}
              </button>
            </div>
            {error && <div className={s.errorText}>{error}</div>}
          </div>
        </div>
      ) : (
        <div className={s.guestNotice}>
          코멘트를 남기려면 <Link href="/login">로그인</Link>이 필요합니다.
        </div>
      )}

      <div className={s.commentList}>
        {comments.map((c) => {
          const tone = AVATAR_TONES.gray;
          return (
            <div key={c.id} className={s.comment}>
              <div
                className={s.commentAvatar}
                style={{ background: tone.bg, color: tone.fg }}
              >
                {c.author_name.slice(-2)}
              </div>
              <div className={s.commentBody}>
                <div className={s.commentHead}>
                  <span className={s.commentName}>{c.author_name}</span>
                  <span className={s.roleTag} style={tagStyle(c.role_tag)}>
                    {c.role_tag}
                  </span>
                  <span className={s.commentWhen}>{shortDateKo(c.created_at)}</span>
                </div>
                <div className={s.commentText}>{c.body}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
