"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { SRC } from "@/lib/domain";
import { hhmm } from "@/lib/format";
import type { SyncRunRow } from "@/types/db";
import s from "./admin.module.css";

interface SourceStat {
  kind: "gh" | "hn" | "ax";
  count: string;
  note: string;
  last: string;
}

interface Props {
  initialRun: SyncRunRow | null;
  sourceStats: SourceStat[];
  llmLabel: string;
}

const POLL_MS = 2500;

/**
 * 자동 수집 파이프라인 패널 (디자인 697~737행).
 *
 * 디자인에서는 PIPE_STEPS 를 타이머로 흘려보내는 애니메이션이었지만,
 * 여기서는 sync_runs.logs 를 폴링해 실제 진행 상황을 보여준다.
 */
export default function PipelinePanel({ initialRun, sourceStats, llmLabel }: Props) {
  const router = useRouter();
  const [run, setRun] = useState<SyncRunRow | null>(initialRun);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 폴링 대상. 페이지 진입 시 이미 돌고 있던 실행이 있으면 이어서 따라간다.
  const [activeRunId, setActiveRunId] = useState<string | null>(
    initialRun?.status === "running" ? initialRun.id : null,
  );

  const running = run?.status === "running" || busy;

  useEffect(() => {
    if (!activeRunId) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch(`/api/admin/pipeline/${activeRunId}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const j = (await res.json()) as { run: SyncRunRow };
          if (cancelled) return;
          setRun(j.run);
          if (j.run.status !== "running") {
            setActiveRunId(null);
            router.refresh(); // 완료되면 통계·목록을 새로 읽는다
            return;
          }
        }
      } catch {
        // 일시적 네트워크 오류는 다음 주기에 다시 시도한다.
      }
      if (!cancelled) timer = setTimeout(() => void tick(), POLL_MS);
    };

    timer = setTimeout(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeRunId, router]);

  async function start(kind: "geeknews" | "trend") {
    if (running) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pipeline/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      const j = (await res.json()) as { runId?: string; error?: string };
      if (!res.ok || !j.runId) throw new Error(j.error ?? "실행에 실패했습니다.");

      setRun({
        id: j.runId,
        kind,
        provider: null,
        trigger: "admin_ui",
        status: "running",
        started_at: new Date().toISOString(),
        finished_at: null,
        fetched_count: 0,
        new_count: 0,
        inserted_count: 0,
        skipped_count: 0,
        logs: [],
        error: null,
      });
      setActiveRunId(j.runId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "실행에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const dotClass =
    run?.status === "running"
      ? s.consoleDotRunning
      : run?.status === "success"
        ? s.consoleDotDone
        : run?.status === "failed"
          ? s.consoleDotFailed
          : "";

  return (
    <div className={s.panel} id="pipeline">
      <div className={s.panelHead}>
        <div>
          <div className={s.panelTitle}>자동 수집 파이프라인</div>
          <div className={s.panelDesc}>
            GitHub Trending · Hacker News · arXiv · 긱뉴스를 수집해 한국어 요약 초안을
            만듭니다 · {llmLabel}
          </div>
        </div>
        <button
          type="button"
          className={s.primaryBtn}
          onClick={() => void start("trend")}
          disabled={running}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 4v5h-5" />
          </svg>
          {running ? "수집 진행 중…" : "최신 트렌드 정보 업데이트하기"}
        </button>
      </div>

      <div className={s.sourceGrid}>
        {sourceStats.map((p) => {
          const style = SRC[p.kind];
          return (
            <div key={p.kind} className={s.sourceCard}>
              <div className={s.sourceHead}>
                <span
                  className={s.sourceTag}
                  style={{ background: style.bg, color: style.fg }}
                >
                  {style.tag}
                </span>
                <span className={s.sourceLast}>{p.last}</span>
              </div>
              <div className={s.sourceCount}>{p.count}</div>
              <div className={s.sourceNote}>{p.note}</div>
            </div>
          );
        })}
      </div>

      <div className={s.console}>
        <div className={s.consoleHead}>
          <span className={`${s.consoleDot} ${dotClass}`} />
          <span className={s.consoleName}>
            pipeline.log{run ? ` · ${run.kind}` : ""}
          </span>
          <span className={s.consolePct}>
            {run
              ? `${run.inserted_count}/${run.new_count || run.fetched_count} 저장`
              : "0%"}
          </span>
        </div>

        {!run || run.logs.length === 0 ? (
          <div className={s.consoleIdle}>
            대기 중 — 최신 트렌드 업데이트 버튼을 누르면 수집이 시작됩니다.
          </div>
        ) : (
          <div className={s.consoleLines}>
            {run.logs.map((l, i) => (
              <div
                key={i}
                className={[
                  s.consoleLine,
                  l.level === "done" ? s.consoleLineDone : "",
                  l.level === "warn" ? s.consoleLineWarn : "",
                  l.level === "error" ? s.consoleLineError : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
              >
                [{l.at}] {l.msg}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="button"
          onClick={() => void start("geeknews")}
          disabled={running}
          style={{
            fontSize: 12.5,
            fontWeight: 500,
            color: running ? "var(--gray-400)" : "var(--purple-600)",
          }}
        >
          긱뉴스만 동기화 (LLM 미사용)
        </button>
        {run?.finished_at && (
          <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--gray-500)" }}>
            마지막 실행 {hhmm(run.finished_at)} · {run.status === "success" ? "성공" : "실패"}
          </span>
        )}
      </div>

      {error && <div className={s.errorBox}>{error}</div>}
      {run?.status === "failed" && run.error && (
        <div className={s.errorBox}>{run.error}</div>
      )}
    </div>
  );
}
