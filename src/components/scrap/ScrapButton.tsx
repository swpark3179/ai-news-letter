"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SavableType } from "@/lib/data/scraps";
import s from "./scrap.module.css";

interface Props {
  targetType: SavableType;
  targetKey: string;
  /** 서버에서 읽어 온 현재 보관 여부 */
  initialSaved: boolean;
  /** pill = 목록 행 오른쪽의 작은 버튼 · byline = 기사 상세 바이라인 줄의 버튼 */
  variant?: "pill" | "byline";
  /** 보관을 빼면 목록에서 사라져야 하는 화면(보관함)에서 켠다 */
  refreshOnChange?: boolean;
}

/**
 * 보관함 담기 / 빼기 버튼.
 *
 * 낙관적으로 먼저 칠하고 실패하면 되돌린다. 목록 행에서는 제목 링크와 나란히
 * 놓이므로 클릭이 링크로 새어 나가지 않게 막는다.
 */
export default function ScrapButton({
  targetType,
  targetKey,
  initialSaved,
  variant = "pill",
  refreshOnChange = false,
}: Props) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [serverSaved, setServerSaved] = useState(initialSaved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 서버에서 다시 읽어 온 값이 바뀌면 그쪽을 따른다 (렌더 중 조정 패턴).
  // router.refresh() 뒤에도 버튼이 옛 상태로 남지 않게 한다.
  if (serverSaved !== initialSaved) {
    setServerSaved(initialSaved);
    setSaved(initialSaved);
  }

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;

    const next = !saved;
    setSaved(next);
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/scraps", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType, targetKey, saved: next }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "보관 상태를 바꾸지 못했습니다.");
      }
      if (refreshOnChange) router.refresh();
    } catch (err) {
      setSaved(!next);
      setError(err instanceof Error ? err.message : "보관 상태를 바꾸지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const wide = variant === "byline";
  const label = wide
    ? saved
      ? "보관함에 담김"
      : "보관함에 담기"
    : saved
      ? "보관됨"
      : "보관";

  return (
    <span className={wide ? s.bylineWrap : s.wrap}>
      <button
        type="button"
        onClick={(e) => void toggle(e)}
        disabled={busy}
        aria-pressed={saved}
        title={saved ? "보관함에서 빼기" : "보관함에 담기"}
        className={[wide ? s.byline : s.pill, saved ? s.on : "", busy ? s.busy : ""]
          .filter(Boolean)
          .join(" ")}
      >
        <svg
          width={wide ? "14" : "13"}
          height={wide ? "14" : "13"}
          viewBox="0 0 24 24"
          fill={saved ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" />
        </svg>
        {label}
      </button>
      {error && <span className={s.error}>{error}</span>}
    </span>
  );
}
