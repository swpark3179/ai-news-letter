import type { SsoMode } from "@/lib/env";

/**
 * 마지막 로그인 시도 기록 (브라우저 sessionStorage).
 *
 * 로그인 화면에서 실패한 직후 진단 화면으로 넘어오면, 그 실패가 무엇이었는지가
 * 이미 사라져 있다 — 화면을 옮기는 순간 React 상태가 날아가기 때문이다. 그래서
 * 실패(와 성공)를 한 건만 남겨 두고 진단 화면이 그것을 읽는다.
 *
 * sessionStorage 를 쓰는 이유: 탭을 닫으면 함께 사라지고, 같은 탭 안의 이동
 * (/login → /login/diag)에서는 남는다. 진단에 필요한 수명이 정확히 그만큼이다.
 *
 * 읽기·쓰기 모두 예외를 삼킨다. 사생활 보호 모드나 저장소가 막힌 브라우저에서
 * 진단 기록 때문에 로그인이 깨지면 안 된다.
 */

const KEY = "ainl.sso.lastAttempt";

export interface SsoAttemptRecord {
  at: string;
  mode: SsoMode;
  outcome: "성공" | "실패";
  /** 마지막으로 완료된 진행 단계 (AUTH_STEPS 인덱스, -1 = 시작 전) */
  step: number;
  elapsedSec: number;
  /** SSO 실패 코드 — 트레이 쪽 실패일 때만 */
  failureCode: string | null;
  /** 서버가 세션을 못 만든 경우의 메시지 */
  serverError: string | null;
  /** 서버 로그와 잇는 상관 ID (x-sso-trace-id) */
  traceId: string | null;
  trayUrl: string;
  appCode: string;
}

export function recordAttempt(r: SsoAttemptRecord): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* 저장소가 막혀 있으면 기록을 포기한다 — 로그인은 계속되어야 한다 */
  }
  cached = r;
  notify();
}

export function readLastAttempt(): SsoAttemptRecord | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * useSyncExternalStore 용 어댑터
 *
 * sessionStorage 는 React 밖의 저장소이므로, 화면은 그것을 「구독」해서 읽는다.
 * useEffect + setState 로 옮겨 담으면 렌더가 한 번 더 돌고, 서버 렌더와 값이
 * 달라 하이드레이션이 어긋난다. 스냅샷은 캐시해야 한다 — getSnapshot 이 매번
 * 새 객체를 돌려주면 React 가 무한 렌더로 본다.
 * ------------------------------------------------------------------------ */

let cached: SsoAttemptRecord | null | undefined;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function subscribeAttempt(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function attemptSnapshot(): SsoAttemptRecord | null {
  if (cached === undefined) cached = readLastAttempt();
  return cached;
}

/** 서버 렌더에는 sessionStorage 가 없다. */
export function attemptServerSnapshot(): null {
  return null;
}

/** 저장소를 다시 읽는다 (로그인을 시도하고 돌아온 뒤 쓴다). */
export function refreshAttempt(): void {
  cached = readLastAttempt();
  notify();
}

function isRecord(v: unknown): v is SsoAttemptRecord {
  return !!v && typeof v === "object" && typeof (v as SsoAttemptRecord).at === "string";
}

export function attemptToText(r: SsoAttemptRecord): string {
  return [
    `# 마지막 로그인 시도 — ${r.at}`,
    `모드 ${r.mode} · 결과 ${r.outcome} · 단계 ${r.step + 1}/4 · 경과 ${r.elapsedSec}초`,
    `실패 코드 ${r.failureCode ?? "(없음)"} · 상관 ID ${r.traceId ?? "(없음)"}`,
    r.serverError ? `서버 오류: ${r.serverError}` : "",
    `트레이 ${r.trayUrl || "(비어 있음)"} · 앱 코드 ${r.appCode || "(비어 있음)"}`,
  ]
    .filter(Boolean)
    .join("\n");
}
