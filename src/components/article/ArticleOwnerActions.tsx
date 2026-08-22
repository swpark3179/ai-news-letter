"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { routes } from "@/lib/routes";
import type { WritableSection } from "@/types/db";
import s from "./article.module.css";

interface Props {
  articleId: string;
  section: WritableSection;
  /** 발행 전 글이면 삭제해도 잃을 게 적다는 걸 문구로 구분한다 */
  isDraft: boolean;
  commentCount: number;
}

/** 작성자 본인·관리자에게만 보이는 수정 / 삭제 줄. */
export default function ArticleOwnerActions({
  articleId,
  section,
  isDraft,
  commentCount,
}: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (busy) return;

    const warn = isDraft
      ? "임시저장된 이 글을 삭제할까요?"
      : commentCount > 0
        ? `이 글을 삭제할까요? 코멘트 ${commentCount}건과 발표 자료도 함께 지워집니다.`
        : "이 글을 삭제할까요? 발표 자료도 함께 지워집니다.";
    if (!window.confirm(warn)) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/articles/${articleId}`, { method: "DELETE" });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "삭제에 실패했습니다.");
      }
      router.replace(routes.section(section));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "삭제에 실패했습니다.");
      setBusy(false);
    }
  }

  return (
    <div className={s.ownerBar}>
      <Link href={routes.articleEdit({ id: articleId })} className={s.ownerEdit}>
        수정
      </Link>
      <button
        type="button"
        className={s.ownerDelete}
        onClick={() => void remove()}
        disabled={busy}
      >
        {busy ? "삭제 중…" : "삭제"}
      </button>
      {error && <span className={s.ownerError}>{error}</span>}
    </div>
  );
}
