"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { devAuthEnv } from "@/lib/env";
import {
  AUTH_FAILURES,
  AUTH_STEPS,
  SsoError,
  createSsoClient,
  failureOf,
  isMockSso,
  type SsoFailureCode,
} from "@/lib/auth/sso";
import { hhmm } from "@/lib/format";
import s from "./login.module.css";

type Phase = "running" | "failed" | "manual";

/** 서버 오류일 때 보여 줄 확인 항목 — 실제로 겪은 순서대로 */
const SERVER_ERROR_HINTS = [
  {
    t: "Supabase 설정 확인",
    d: "SUPABASE_URL 은 Project URL 이어야 합니다. REST 엔드포인트(.../rest/v1/)를 넣으면 요청 경로가 깨집니다.",
  },
  {
    t: "스키마 적용 여부",
    d: "supabase/ALL_MIGRATIONS.sql 을 SQL Editor 에서 실행했는지 확인하세요. members 테이블이 없으면 로그인할 수 없습니다.",
  },
  {
    t: "사내 프록시",
    d: "fetch failed 라면 프록시 문제입니다. HTTPS_PROXY 를 설정한 뒤 개발 서버를 재시작하세요.",
  },
];

interface Props {
  next: string;
  /** ?fail=CODE 로 강제한 실패 시나리오 (목업 전용) */
  forcedFailure: SsoFailureCode | null;
}

/**
 * 사번 폴백과 게스트 열람을 화면에 내보일지.
 *
 * 최종 방침은 「사내 SSO 를 통과하지 못하면 일반 사용을 제공하지 않는다」다.
 * 두 경로는 서버(`/api/auth/signin` · `/api/auth/guest`)에서 이미 403 으로
 * 막혀 있고, 여기서는 실 모드에서 눌러 볼 수 없게 감추기만 한다.
 *
 * `isMockSso` 가 아니라 이 값을 쓰는 이유: NEXT_PUBLIC_SSO_MODE 의 기본값이
 * mock 이라 목업 모드로 올라간 운영 배포에서도 isMockSso 는 true 다.
 */
const showFallbacks = devAuthEnv.mockShortcuts;

export default function LoginClient({ next, forcedFailure }: Props) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("running");
  const [step, setStep] = useState(-1); // -1 = 아직 시작 전
  const [elapsed, setElapsed] = useState(0);
  const [failIdx, setFailIdx] = useState(() =>
    forcedFailure ? AUTH_FAILURES.findIndex((f) => f.code === forcedFailure) : 0,
  );
  const [failedAt, setFailedAt] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  /** SSO 자체가 아니라 서버(세션 발급)에서 난 오류 — 안내 문구를 따로 쓴다 */
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [empNo, setEmpNo] = useState("");
  const [password, setPassword] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const attemptRef = useRef(0);

  // --- 세션 확정 후 이동 ---------------------------------------------------
  const goNext = useCallback(() => {
    router.replace(next || "/");
    router.refresh();
  }, [router, next]);

  // --- SSO 자동 로그인 -----------------------------------------------------
  const runSso = useCallback(async () => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const attempt = ++attemptRef.current;

    setPhase("running");
    setStep(-1);
    setElapsed(0);
    setError(null);
    setServerError(null);

    try {
      const client = createSsoClient(forcedFailure);
      const { encoded } = await client.authenticate((i) => {
        if (attemptRef.current === attempt) setStep(i);
      }, ac.signal);

      const res = await fetch("/api/auth/sso", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ encoded }),
        signal: ac.signal,
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "세션 발급에 실패했습니다.");
      }
      if (attemptRef.current !== attempt) return;
      goNext();
    } catch (e) {
      if (attemptRef.current !== attempt) return;
      if (e instanceof DOMException && e.name === "AbortError") return;

      setFailedAt(hhmm(new Date()));
      if (e instanceof SsoError) {
        // 트레이 모듈 쪽 실패 — 디자인의 안내 카드 3종 중 하나를 보여 준다.
        const idx = AUTH_FAILURES.findIndex((f) => f.code === e.code);
        setFailIdx(idx >= 0 ? idx : 0);
        setServerError(null);
      } else {
        // 인증 자체는 됐지만 서버가 세션을 못 만든 경우 (DB 연결 실패 등).
        // 트레이 안내를 띄우면 엉뚱한 곳을 보게 되므로 실제 원인을 그대로 보여 준다.
        setServerError(
          e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.",
        );
      }
      setPhase("failed");
    }
  }, [forcedFailure, goNext]);

  useEffect(() => {
    void runSso();
    return () => abortRef.current?.abort();
  }, [runSso]);

  // 경과 초 카운터
  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // --- 사번 로그인 ---------------------------------------------------------
  async function submitManual(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/signin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ empNo: empNo.trim(), password }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? "로그인에 실패했습니다.");
      }
      goNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "로그인에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  // --- 게스트 -------------------------------------------------------------
  async function continueAsGuest() {
    abortRef.current?.abort();
    attemptRef.current++;
    await fetch("/api/auth/guest", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  function goManual() {
    if (!showFallbacks) return;
    abortRef.current?.abort();
    attemptRef.current++;
    setError(null);
    setPhase("manual");
  }

  const fail = failureOf(AUTH_FAILURES[failIdx % AUTH_FAILURES.length].code);

  return (
    <div className={s.page}>
      <div className={s.brand}>
        <span className={s.brandAi}>AI</span>
        <span className={s.brandKo}>뉴스레터</span>
        <span className={s.brandOrg}>Samsung SDS · AI Unit</span>
      </div>

      {phase === "running" && (
        <div className={`${s.card} ${s.cardRunning}`}>
          <div className={s.runningHead}>
            <div className={s.spinner} />
            <div>
              <div className={s.runningTitle}>사내 SSO로 로그인 중</div>
              <div className={s.runningDesc}>
                Tray 인증 모듈에 자동 로그인을 요청했습니다 · 경과 {elapsed}초
              </div>
            </div>
          </div>

          <div className={s.steps}>
            {AUTH_STEPS.map((label, i) => {
              const done = i <= step;
              const active = i === step + 1;
              return (
                <div key={label} className={s.step}>
                  <span
                    className={[
                      s.stepDot,
                      done ? s.stepDotDone : "",
                      active ? s.stepDotActive : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {done ? "✓" : ""}
                  </span>
                  <span
                    className={[
                      s.stepLabel,
                      done ? s.stepLabelDone : "",
                      active ? s.stepLabelActive : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {label}
                  </span>
                  <span className={s.stepNote}>
                    {done ? "완료" : active ? "진행 중" : "대기"}
                  </span>
                </div>
              );
            })}
          </div>

          <div className={s.runningFoot}>
            <span className={s.footHint}>
              네트워크 상황에 따라 최대 30초까지 걸릴 수 있습니다
            </span>
            {showFallbacks && (
              <button
                type="button"
                className={`${s.linkPurple} ${s.pushRight}`}
                onClick={goManual}
              >
                사번으로 로그인
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "failed" && (
        <div className={`${s.card} ${s.cardFailed}`}>
          <div className={s.failHead}>
            <div className={s.failMark}>!</div>
            <div>
              <div className={s.failTitle}>
                {serverError ? "로그인 처리 중 서버 오류가 발생했습니다" : fail.title}
              </div>
              <div className={s.failDesc}>
                {serverError
                  ? "사내 인증은 통과했지만 서버가 세션을 만들지 못했습니다. 인증 모듈이 아니라 서버 설정 문제입니다."
                  : fail.desc}
              </div>
              <div className={s.failCode}>
                {serverError ? "SESSION_CREATE_FAILED" : fail.code} · {failedAt}
              </div>
            </div>
          </div>

          <div className={s.checkBox}>
            <div className={s.checkBoxTitle}>
              {serverError ? "서버 응답" : "확인할 항목"}
            </div>
            {serverError ? (
              <>
                <pre className={s.serverErrorDetail}>{serverError}</pre>
                <div className={s.checkList} style={{ marginTop: 12 }}>
                  {SERVER_ERROR_HINTS.map((c) => (
                    <div key={c.t} className={s.checkItem}>
                      <span className={s.checkBullet}>·</span>
                      <div>
                        <div className={s.checkItemTitle}>{c.t}</div>
                        <div className={s.checkItemDesc}>{c.d}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className={s.checkList}>
                {fail.checks.map((c) => (
                  <div key={c.t} className={s.checkItem}>
                    <span className={s.checkBullet}>·</span>
                    <div>
                      <div className={s.checkItemTitle}>{c.t}</div>
                      <div className={s.checkItemDesc}>{c.d}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {error && <div className={s.errorText}>{error}</div>}

          <div className={s.failActions}>
            <button type="button" className={s.btnPrimary} onClick={() => void runSso()}>
              SSO 다시 시도
            </button>
            {showFallbacks && (
              <>
                <button type="button" className={s.btnGhost} onClick={goManual}>
                  사번으로 로그인
                </button>
                <button
                  type="button"
                  className={`${s.linkPurple} ${s.pushRight}`}
                  onClick={() => void continueAsGuest()}
                >
                  뉴스레터로 이동 →
                </button>
              </>
            )}
          </div>

          <div className={s.failFoot}>
            <span>
              {showFallbacks
                ? "로그인 없이 이동하면 공개 기사만 열람할 수 있습니다"
                : "사내 SSO 인증을 통과해야 열람할 수 있습니다"}
            </span>
            {isMockSso && !serverError && (
              <button
                type="button"
                className={s.pushRight}
                style={{ color: "var(--gray-500)", fontSize: 11.5, cursor: "pointer" }}
                onClick={() => setFailIdx((i) => i + 1)}
              >
                다른 실패 사례 보기
              </button>
            )}
          </div>
        </div>
      )}

      {phase === "manual" && (
        <form className={`${s.card} ${s.cardManual}`} onSubmit={submitManual}>
          <div className={s.manualTitle}>사번으로 로그인</div>
          <div className={s.manualDesc}>
            SSO 자동 로그인을 사용할 수 없어 사번 로그인으로 전환했습니다.
          </div>

          <div className={s.fields}>
            <div>
              <div className={s.fieldLabel}>사번</div>
              <input
                className={s.input}
                value={empNo}
                onChange={(e) => setEmpNo(e.target.value)}
                placeholder="21084213"
                autoComplete="username"
                inputMode="numeric"
                required
              />
            </div>
            <div>
              <div className={s.fieldLabel}>비밀번호</div>
              <input
                className={`${s.input} ${s.inputPassword}`}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>
          </div>

          {error && <div className={s.errorText}>{error}</div>}

          <button type="submit" className={s.manualSubmit} disabled={busy}>
            {busy ? "확인 중…" : "로그인"}
          </button>

          <div className={s.manualLinks}>
            <button type="button" className={s.linkGray} onClick={() => void runSso()}>
              SSO 다시 시도
            </button>
            <button
              type="button"
              className={`${s.linkPurple} ${s.pushRight}`}
              onClick={() => void continueAsGuest()}
            >
              뉴스레터로 이동 →
            </button>
          </div>

          {/* phase === "manual" 은 showFallbacks 일 때만 도달한다 (goManual 참고) */}

          {isMockSso && (
            <div className={s.mockBadge}>
              목업 모드 — 비밀번호는 검증하지 않습니다
            </div>
          )}
        </form>
      )}

      <div className={s.notice}>
        사내 문서 보안 등급 II · 외부 공유 금지
        <br />
        문의 · AI Unit 박세원
      </div>
    </div>
  );
}
