"use client";

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { devAuthEnv, ssoPublicEnv } from "@/lib/env";
import { createSsoClient } from "@/lib/auth/sso";
import {
  DIAG_TOKEN_HEADER,
  dryRunToText,
  snapshotToText,
  statusMark,
  verdictKindLabel,
  type DiagStatus,
  type DiagVerdict,
  type SsoDiagSnapshot,
  type SsoDryRun,
} from "@/lib/auth/sso/diag-types";
import {
  attemptServerSnapshot,
  attemptSnapshot,
  attemptToText,
  refreshAttempt,
  subscribeAttempt,
} from "@/lib/auth/sso/last-attempt";
import {
  probeToText,
  probeTray,
  type ProbeEvent,
  type ProbeResult,
} from "@/lib/auth/sso/probe";
import { analyzeField, describeShape } from "@/lib/auth/sso/shape";
import type { SsoTrayPayload } from "@/lib/auth/sso/types";
import s from "./diag.module.css";

/* ===========================================================================
 * SSO 로그인 진단 — 4단계
 * ===========================================================================
 *
 * 「로그인이 안 된다」에서 원인을 좁히는 순서를 화면으로 굳혀 둔 것이다. 각 단계는
 * 바로 앞 단계가 깨끗할 때만 의미가 있다 — 순서가 곧 진단이다.
 *
 *   0 브라우저에 실린 값   빌드에 박힌 NEXT_PUBLIC_ 값과 마지막 시도의 결과
 *   1 서버 변수 · 세션 · DB  「변수 로드」 문제를 여기서 전부 걸러낸다
 *   2 트레이 핸드셰이크     소켓이 열리는지, 어떤 프레임이 오는지 (원문 그대로)
 *   3 서버 디코딩 드라이런  어느 전략이 통하는지, EPID·등록 대조까지 (세션은 발급 안 함)
 *
 * 마지막에 실제 로그인을 한 번 더 시도하고 1단계를 다시 실행하면, 「로그인은 됐는데
 * 세션이 안 남는 것」과 「로그인 자체가 안 되는 것」이 갈린다.
 * ------------------------------------------------------------------------ */

const DIAG_ENDPOINT = "/api/auth/sso/diag";

export default function DiagClient({ token }: { token: string }) {
  const real = ssoPublicEnv.mode === "real";

  // 로그인 화면이 sessionStorage 에 남긴 마지막 시도. React 밖의 저장소라 구독해서 읽는다.
  const attempt = useSyncExternalStore(
    subscribeAttempt,
    attemptSnapshot,
    attemptServerSnapshot,
  );

  const [snapshot, setSnapshot] = useState<SsoDiagSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotBusy, setSnapshotBusy] = useState(false);

  const [probeEvents, setProbeEvents] = useState<ProbeEvent[]>([]);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const [payloadText, setPayloadText] = useState("");
  const [dryRun, setDryRun] = useState<SsoDryRun | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const [dryRunBusy, setDryRunBusy] = useState(false);

  const [copied, setCopied] = useState<string | null>(null);

  const headers = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (token) h[DIAG_TOKEN_HEADER] = token;
    return h;
  }, [token]);

  // --- 1단계 ---------------------------------------------------------------
  const loadSnapshot = useCallback(async () => {
    setSnapshotBusy(true);
    setSnapshotError(null);
    try {
      const res = await fetch(DIAG_ENDPOINT, { headers, cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as
        | SsoDiagSnapshot
        | { error?: string };
      if (!res.ok) {
        throw new Error(
          ("error" in body && body.error) ||
            `진단 API 가 ${res.status} 를 돌려주었습니다.`,
        );
      }
      setSnapshot(body as SsoDiagSnapshot);
    } catch (e) {
      setSnapshot(null);
      setSnapshotError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setSnapshotBusy(false);
    }
  }, [headers]);

  /**
   * 1단계 실행 = 「서버에 다시 물어보기」 + 「마지막 시도 기록 다시 읽기」.
   *
   * 두 개를 묶어 두는 이유: 진단의 마지막 절차가 「실제로 로그인해 보고 돌아와
   * 1단계를 다시 실행한다」인데, 그때 새로 볼 것이 세션 쿠키 상태와 그 시도의
   * 결과 두 가지다. 따로 두면 한쪽만 갱신된 화면을 보게 된다.
   *
   * 화면을 열 때 자동으로 돌리지 않는다 — 단계마다 무엇이 언제 실행됐는지가
   * 분명해야 진단으로 쓸 수 있고, 열기만 해도 API 가 호출되면 레이트리밋을
   * 까먹는다.
   */
  const refresh = useCallback(async () => {
    refreshAttempt();
    await loadSnapshot();
  }, [loadSnapshot]);

  // --- 2단계 ---------------------------------------------------------------
  /**
   * 실 모드는 트레이에 직접 붙어 오간 것을 전부 기록한다. 목업 모드에는 붙을 트레이가
   * 없으므로 목업 클라이언트를 돌려 페이로드를 만든다 — 그러면 3단계까지 같은 방식으로
   * 이어져 진단 자체가 개발 환경에서 검증된다.
   */
  const runProbe = useCallback(async () => {
    setProbeBusy(true);
    setProbe(null);
    setProbeEvents([]);
    setDryRun(null);
    setDryRunError(null);

    if (!real) {
      const events: ProbeEvent[] = [
        { atMs: 0, kind: "config", text: "목업 모드 — 트레이에 붙지 않고 목업 페이로드를 만듭니다." },
      ];
      setProbeEvents(events);
      const started = Date.now();
      try {
        const payload = await createSsoClient(null).authenticate(
          (i) => {
            const e: ProbeEvent = {
              atMs: Date.now() - started,
              kind: "frame",
              text: `목업 진행 단계 ${i + 1}/3`,
            };
            events.push(e);
            setProbeEvents([...events]);
          },
          new AbortController().signal,
        );
        events.push({
          atMs: Date.now() - started,
          kind: "result",
          text: "목업 페이로드를 만들었습니다.",
        });
        setProbeEvents([...events]);
        setProbe({
          url: "(목업)",
          appCode: "(목업)",
          events,
          opened: true,
          request: "(목업 — WebSocket 을 쓰지 않습니다)",
          payload,
          failure: null,
          closeCode: null,
          elapsedMs: Date.now() - started,
        });
        setPayloadText(JSON.stringify(payload, null, 2));
      } catch (e) {
        events.push({
          atMs: Date.now() - started,
          kind: "error",
          text: e instanceof Error ? e.message : "목업 실패",
        });
        setProbeEvents([...events]);
      } finally {
        setProbeBusy(false);
      }
      return;
    }

    const result = await probeTray({
      url: ssoPublicEnv.trayWsUrl,
      appCode: ssoPublicEnv.trayAppCode,
      onEvent: (e) => setProbeEvents((prev) => [...prev, e]),
    });
    setProbe(result);
    if (result.payload) setPayloadText(JSON.stringify(result.payload, null, 2));
    setProbeBusy(false);
  }, [real]);

  // --- 3단계 ---------------------------------------------------------------
  const runDryRun = useCallback(async () => {
    setDryRunBusy(true);
    setDryRunError(null);
    setDryRun(null);

    let parsed: SsoTrayPayload;
    try {
      parsed = JSON.parse(payloadText) as SsoTrayPayload;
    } catch {
      setDryRunError(
        'JSON 으로 읽히지 않습니다. {"kind":"knox","userInfo":"…","privateKey":"…"} 형태여야 합니다.',
      );
      setDryRunBusy(false);
      return;
    }

    try {
      const res = await fetch(DIAG_ENDPOINT, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const body = (await res.json().catch(() => ({}))) as SsoDryRun | { error?: string };
      if (!res.ok) {
        throw new Error(
          ("error" in body && body.error) || `드라이런이 ${res.status} 를 돌려주었습니다.`,
        );
      }
      setDryRun(body as SsoDryRun);
    } catch (e) {
      setDryRunError(e instanceof Error ? e.message : "알 수 없는 오류");
    } finally {
      setDryRunBusy(false);
    }
  }, [headers, payloadText]);

  // --- 복사 ----------------------------------------------------------------
  const copy = useCallback(async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied("복사 실패 — 직접 선택해 주세요");
    }
  }, []);

  const clientText = useMemo(
    () =>
      [
        "# 브라우저에 실린 값 (빌드 산출물)",
        `모드 ${ssoPublicEnv.mode}`,
        `트레이 ${ssoPublicEnv.trayWsUrl || "(비어 있음)"}`,
        `앱 코드 ${ssoPublicEnv.trayAppCode || "(비어 있음)"}`,
        `목업 우회 경로 ${devAuthEnv.mockShortcuts ? "열림" : "닫힘"}`,
        attempt ? `\n${attemptToText(attempt)}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    [attempt],
  );

  const everything = useMemo(
    () =>
      [
        clientText,
        snapshot ? snapshotToText(snapshot) : "(1단계 미실행)",
        probe ? probeToText(probe, showRaw) : "(2단계 미실행)",
        dryRun ? dryRunToText(dryRun) : "(3단계 미실행)",
      ].join("\n\n---\n\n"),
    [clientText, snapshot, probe, dryRun, showRaw],
  );

  return (
    <div className={s.page}>
      <header className={s.head}>
        <div>
          <h1 className={s.title}>SSO 로그인 진단</h1>
          <p className={s.subtitle}>
            로그인이 안 되는 원인을 <b>변수 로드</b>와 <b>연동 로직</b>으로 가릅니다.
            위에서 아래로 실행하세요 — 앞 단계가 깨끗할 때만 다음 단계가 의미를 가집니다.
          </p>
        </div>
        <div className={s.headActions}>
          <button
            type="button"
            className={s.btnGhost}
            onClick={() => void copy("전체", everything)}
          >
            전체 결과 복사
          </button>
          <a className={s.btnGhost} href="/login?force=1">
            로그인 화면으로
          </a>
        </div>
      </header>

      {copied && <div className={s.toast}>{copied} 복사했습니다</div>}

      {/* ── 0단계 ─────────────────────────────────────────────────────── */}
      <Stage
        n={0}
        title="브라우저에 실린 값"
        desc="NEXT_PUBLIC_ 값은 빌드 시점에 코드로 박힙니다. 여기 보이는 것이 지금 이 화면이 실제로 쓰는 값입니다 — 배포 환경변수와 다를 수 있습니다."
        onCopy={() => void copy("0단계", clientText)}
      >
        <dl className={s.kv}>
          <Row k="NEXT_PUBLIC_SSO_MODE" v={ssoPublicEnv.mode} />
          <Row k="NEXT_PUBLIC_SSO_TRAY_WS_URL" v={ssoPublicEnv.trayWsUrl || "(비어 있음)"} />
          <Row
            k="NEXT_PUBLIC_SSO_TRAY_APP_CODE"
            v={ssoPublicEnv.trayAppCode || "(비어 있음)"}
          />
          <Row
            k="목업 우회 경로 (사번 폴백 · 게스트 · 자동 세션)"
            v={devAuthEnv.mockShortcuts ? "열림" : "닫힘"}
          />
        </dl>

        <h3 className={s.subhead}>마지막 로그인 시도</h3>
        {attempt ? (
          <dl className={s.kv}>
            <Row k="시각" v={new Date(attempt.at).toLocaleString("ko-KR")} />
            <Row
              k="결과"
              v={`${attempt.outcome} · 단계 ${attempt.step + 1}/4 · 경과 ${attempt.elapsedSec}초`}
            />
            <Row k="실패 코드" v={attempt.failureCode ?? "(없음)"} />
            <Row k="서버 오류" v={attempt.serverError ?? "(없음)"} />
            <Row
              k="상관 ID"
              v={attempt.traceId ?? "(없음)"}
              note="서버 로그에서 이 값으로 해당 줄을 찾을 수 있습니다."
            />
          </dl>
        ) : (
          <p className={s.empty}>
            이 탭에서 로그인을 시도한 기록이 없습니다.{" "}
            <a href="/login?force=1">로그인 화면</a>에서 한 번 시도한 뒤 돌아오면 여기에
            남습니다.
          </p>
        )}
      </Stage>

      {/* ── 1단계 ─────────────────────────────────────────────────────── */}
      <Stage
        n={1}
        title="서버 변수 · 세션 · DB"
        desc="배포에 값이 들어왔는지, 빌드에 박힌 값과 같은지, members 를 읽을 수 있는지 확인합니다. 「변수 로드」 문제는 전부 이 단계에서 걸러집니다."
        onCopy={snapshot ? () => void copy("1단계", snapshotToText(snapshot)) : undefined}
        action={
          <button
            type="button"
            className={s.btnPrimary}
            onClick={() => void refresh()}
            disabled={snapshotBusy}
          >
            {snapshotBusy ? "확인 중…" : snapshot ? "다시 실행" : "실행"}
          </button>
        }
      >
        {snapshotError && (
          <div className={s.errorBox}>
            <b>진단을 열지 못했습니다.</b>
            <pre className={s.pre}>{snapshotError}</pre>
            <p className={s.hint}>
              운영 배포에서는 <code>SSO_DEBUG_TOKEN</code> 을 설정하고{" "}
              <code>/login/diag?token=&lt;값&gt;</code> 으로 열어야 합니다. 관리자 세션이
              살아 있는 브라우저라면 토큰 없이도 열립니다.
            </p>
          </div>
        )}

        {snapshot && (
          <>
            <VerdictBox verdict={snapshot.verdict} />
            <dl className={s.kv}>
              <Row
                k="런타임"
                v={[
                  snapshot.runtime.nodeEnv,
                  snapshot.runtime.vercelEnv,
                  snapshot.runtime.region,
                  snapshot.runtime.nextRuntime,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
              <Row k="서버 시각 (KST)" v={snapshot.runtime.serverTimeKst} />
              <Row k="진단 권한" v={accessLabel(snapshot.via)} />
            </dl>

            {snapshot.groups.map((g) => (
              <section key={g.id} className={s.group}>
                <h3 className={s.subhead}>{g.title}</h3>
                {g.note && <p className={s.note}>{g.note}</p>}
                <ul className={s.checks}>
                  {g.checks.map((c) => (
                    <li key={c.id} className={s.check}>
                      <span className={`${s.badge} ${badgeClass(c.status)}`}>
                        {statusMark(c.status)}
                      </span>
                      <div>
                        <div className={s.checkLabel}>{c.label}</div>
                        <div className={s.checkValue}>{c.value}</div>
                        <div className={s.checkDetail}>
                          <Emphasized text={c.detail} />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </Stage>

      {/* ── 2단계 ─────────────────────────────────────────────────────── */}
      <Stage
        n={2}
        title={real ? "트레이 핸드셰이크" : "목업 페이로드 생성"}
        desc={
          real
            ? "트레이 모듈에 직접 물어보고 오간 것을 순서대로 남깁니다. 로그인 화면은 실패를 5종으로 접어 보여 주지만, 여기서는 접기 전의 사실(소켓 개방 여부 · close code · 버려진 프레임)을 그대로 봅니다."
            : "목업 모드에는 붙을 트레이가 없습니다. 대신 목업 클라이언트로 페이로드를 만들어 3단계까지 같은 경로로 이어 봅니다 — 진단 자체가 제대로 도는지 확인하는 데 씁니다."
        }
        onCopy={probe ? () => void copy("2단계", probeToText(probe, showRaw)) : undefined}
        action={
          <button
            type="button"
            className={s.btnPrimary}
            onClick={() => void runProbe()}
            disabled={probeBusy}
          >
            {probeBusy ? "진행 중…" : real ? "핸드셰이크 실행" : "목업 페이로드 생성"}
          </button>
        }
      >
        {real && !ssoPublicEnv.trayWsUrl && (
          <div className={s.errorBox}>
            트레이 주소가 비어 있어 시도할 수 없습니다. 1단계의{" "}
            <code>NEXT_PUBLIC_SSO_TRAY_WS_URL</code> 항목을 보세요.
          </div>
        )}

        {probeEvents.length > 0 && (
          <>
            <div className={s.rawToggle}>
              <label className={s.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={showRaw}
                  onChange={(e) => setShowRaw(e.target.checked)}
                />
                프레임 원문 보기 (암호문이 그대로 나옵니다 — 화면 공유 중이면 끄세요)
              </label>
            </div>
            <ol className={s.log}>
              {probeEvents.map((e, i) => (
                <li key={`${e.atMs}-${i}`} className={s.logRow}>
                  <span className={s.logTime}>{e.atMs}ms</span>
                  <span className={`${s.logKind} ${s[`kind_${e.kind}`] ?? ""}`}>
                    {e.kind}
                  </span>
                  <span className={s.logText}>
                    {e.text}
                    {e.raw && showRaw && <pre className={s.pre}>{e.raw}</pre>}
                  </span>
                </li>
              ))}
            </ol>
          </>
        )}

        {probe?.failure && (
          <div className={s.errorBox}>
            <b>{probe.failure.code}</b>
            <p className={s.hint}>{probe.failure.message}</p>
          </div>
        )}

        {probe?.payload && (
          <div className={s.okBox}>
            <b>페이로드를 받았습니다.</b>
            <dl className={s.kv}>
              {probe.payload.kind === "knox" ? (
                <>
                  <Row
                    k="userInfo"
                    v={describeShape(analyzeField(probe.payload.userInfo))}
                  />
                  <Row k="key" v={describeShape(analyzeField(probe.payload.privateKey))} />
                </>
              ) : (
                <Row k="encoded" v={describeShape(analyzeField(probe.payload.encoded))} />
              )}
            </dl>
            <p className={s.hint}>
              3단계에 자동으로 채워 두었습니다. 세션은 아직 만들어지지 않았습니다.
            </p>
          </div>
        )}
      </Stage>

      {/* ── 3단계 ─────────────────────────────────────────────────────── */}
      <Stage
        n={3}
        title="서버 디코딩 드라이런"
        desc="실제 로그인과 같은 경로(복호화 → 관문 → members 대조)를 밟되 세션을 발급하지 않습니다. 어느 전략이 통했는지와 클레임 키가 규격 확정의 근거입니다."
        onCopy={dryRun ? () => void copy("3단계", dryRunToText(dryRun)) : undefined}
        action={
          <button
            type="button"
            className={s.btnPrimary}
            onClick={() => void runDryRun()}
            disabled={dryRunBusy || !payloadText.trim()}
          >
            {dryRunBusy ? "확인 중…" : "드라이런 실행"}
          </button>
        }
      >
        <label className={s.fieldLabel} htmlFor="payload">
          페이로드 (2단계 결과가 자동으로 들어옵니다 · 직접 붙여 넣어도 됩니다)
        </label>
        <textarea
          id="payload"
          className={s.textarea}
          rows={6}
          spellCheck={false}
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
          placeholder={'{"kind":"knox","userInfo":"…","privateKey":"…"}'}
        />

        {dryRunError && <div className={s.errorBox}>{dryRunError}</div>}

        {dryRun && (
          <>
            <VerdictBox verdict={dryRun.verdict} />

            <h3 className={s.subhead}>페이로드 모양</h3>
            <dl className={s.kv}>
              <Row
                k="모드 · 종류"
                v={`${dryRun.mode} · ${dryRun.payloadKind} · ${dryRun.kindMatchesMode ? "일치" : "불일치 (실제 라우트는 401)"}`}
              />
              {dryRun.shape.userInfo && (
                <Row k="userInfo" v={describeShape(dryRun.shape.userInfo)} />
              )}
              {dryRun.shape.privateKey && (
                <Row k="key" v={describeShape(dryRun.shape.privateKey)} />
              )}
              {dryRun.shape.encoded && (
                <Row k="encoded" v={describeShape(dryRun.shape.encoded)} />
              )}
              <Row k="무결성 게이트" v={gateLabel(dryRun.trace.gate)} />
            </dl>

            <h3 className={s.subhead}>전략별 결과</h3>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>전략</th>
                  <th>결과</th>
                  <th>클레임 키 · 비고</th>
                </tr>
              </thead>
              <tbody>
                {dryRun.trace.attempts.length === 0 && (
                  <tr>
                    <td colSpan={3} className={s.empty}>
                      시도된 전략이 없습니다 (게이트에서 멈췄거나 페이로드 종류가 어긋납니다).
                    </td>
                  </tr>
                )}
                {dryRun.trace.attempts.map((a) => (
                  <tr key={a.strategy}>
                    <td>
                      <code>{a.strategy}</code>
                    </td>
                    <td className={a.outcome === "adopted" ? s.tdOk : s.tdMuted}>
                      {a.outcome}
                    </td>
                    <td>
                      {a.claimKeys?.length ? (
                        <code className={s.claimKeys}>{a.claimKeys.join(", ")}</code>
                      ) : (
                        <span className={s.muted}>{a.detail ?? "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className={s.subhead}>추출 결과 · 등록 대조</h3>
            <dl className={s.kv}>
              <Row
                k="디코딩"
                v={dryRun.decoded.ok ? "성공" : `실패 — ${dryRun.decoded.error ?? "원인 미상"}`}
              />
              <Row
                k="EPID · 사번 · 이름"
                v={`${dryRun.decoded.epid ?? "—"} · ${dryRun.decoded.empNo ?? "—"} · ${dryRun.decoded.name ?? "—"}`}
                note="식별자는 마스킹해 보여 줍니다."
              />
              <Row
                k="이메일 · 부서"
                v={`${dryRun.decoded.hasEmail ? "있음" : "없음"} · ${dryRun.decoded.hasDept ? "있음" : "없음"}`}
              />
              <Row
                k="members 매칭"
                v={
                  dryRun.member.error
                    ? `조회 실패 — ${dryRun.member.error}`
                    : dryRun.member.found
                      ? `${dryRun.member.matchedBy} 로 찾음 · ${dryRun.member.isActive ? "활성" : "중지"} · ${dryRun.member.role}${dryRun.member.isAdmin ? " · 관리자" : ""}`
                      : dryRun.member.wouldAutoCreate
                        ? "없음 — 자동 가입됨"
                        : "없음 — 403 SSO_NOT_REGISTERED"
                }
              />
              {dryRun.member.epidColumnMissing && (
                <Row
                  k="members.epid 컬럼"
                  v="없음 — 0012 미적용"
                  note="사번으로만 대조했습니다. supabase/migrations/0012_member_epid.sql 을 SQL Editor 에서 실행하세요."
                />
              )}
              {dryRun.member.wouldBackfillEpid && (
                <Row k="EPID 백필" v="첫 로그인에서 members.epid 가 채워집니다" />
              )}
              <Row
                k="세션 발급 가능"
                v={dryRun.wouldIssueSession ? "예" : "아니오"}
                note="드라이런은 실제로 쿠키를 만들지 않습니다."
              />
            </dl>
          </>
        )}
      </Stage>

      {/* ── 마무리 ────────────────────────────────────────────────────── */}
      <section className={s.closing}>
        <h2 className={s.closingTitle}>「로그인은 됐는데」를 가리는 방법</h2>
        <ol className={s.closingList}>
          <li>
            <a href="/login?force=1">로그인 화면</a>에서 실제로 한 번 시도합니다.
          </li>
          <li>이 화면으로 돌아와 <b>0단계</b>에서 그 시도의 결과와 상관 ID 를 확인합니다.</li>
          <li>
            <b>1단계를 다시 실행</b>해 세션 쿠키 항목을 봅니다.
            <ul>
              <li>
                <b>유효</b> — 로그인 자체는 통과했습니다. 남은 문제는 SSO 가 아니라 권한·데이터 쪽입니다.
              </li>
              <li>
                <b>있는데 검증 실패</b> — 배포 사이에 <code>SESSION_SECRET</code> 이 바뀐 것입니다.
              </li>
              <li>
                <b>없음</b> — 쿠키가 저장되지 않았습니다. 같은 단계의 <code>secure</code> 항목을 보세요.
              </li>
            </ul>
          </li>
        </ol>
        <p className={s.note}>
          서버 로그에는 시도마다 <code>[sso &lt;상관 ID&gt;]</code> 로 한 줄이 남습니다.
          전략별 결과까지 그 줄에 붙어 있어, 화면 없이도 같은 내용을 확인할 수 있습니다.
        </p>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 표시 부품
// ---------------------------------------------------------------------------

function Stage(props: {
  n: number;
  title: string;
  desc: string;
  action?: React.ReactNode;
  onCopy?: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={s.stage}>
      <div className={s.stageHead}>
        <span className={s.stageNo}>{props.n}</span>
        <div className={s.stageTitleBox}>
          <h2 className={s.stageTitle}>{props.title}</h2>
          <p className={s.stageDesc}>{props.desc}</p>
        </div>
        <div className={s.stageActions}>
          {props.onCopy && (
            <button type="button" className={s.btnGhost} onClick={props.onCopy}>
              복사
            </button>
          )}
          {props.action}
        </div>
      </div>
      <div className={s.stageBody}>{props.children}</div>
    </section>
  );
}

function VerdictBox({ verdict }: { verdict: DiagVerdict }) {
  return (
    <div className={`${s.verdict} ${badgeClass(verdict.status)}`}>
      <div className={s.verdictKind}>{verdictKindLabel(verdict.kind)}</div>
      <div className={s.verdictHead}>{verdict.headline}</div>
      {verdict.next.length > 0 && (
        <ul className={s.verdictNext}>
          {verdict.next.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ k, v, note }: { k: string; v: string; note?: string }) {
  return (
    <div className={s.kvRow}>
      <dt className={s.kvKey}>{k}</dt>
      <dd className={s.kvVal}>
        {v}
        {note && <span className={s.kvNote}>{note}</span>}
      </dd>
    </div>
  );
}

/** 진단 문구의 `**강조**` 를 굵게 — 결론에 해당하는 문장만 눈에 들어오게 한다. */
function Emphasized({ text }: { text: string }) {
  const parts = text.split("**");
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>))}
    </>
  );
}

function badgeClass(status: DiagStatus): string {
  return s[`st_${status}`] ?? "";
}

function accessLabel(via: SsoDiagSnapshot["via"]): string {
  if (via === "admin") return "관리자 세션";
  if (via === "token") return "SSO_DEBUG_TOKEN";
  return "비운영 빌드 (토큰 없이 열림)";
}

function gateLabel(gate: SsoDryRun["trace"]["gate"]): string {
  if (gate === "open") return "통과 — 실제 로그인도 이 지점을 지납니다";
  if (gate === "blocked") return "차단 — 실제 로그인은 여기서 401 이 됩니다";
  return "진단용으로 지나침 — 실제 로그인은 여기서 401 이 됩니다";
}
