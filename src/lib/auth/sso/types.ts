/**
 * 사내 SSO Tray 연동 타입.
 *
 * 흐름
 *   브라우저 ──WebSocket──▶ PC 트레이의 사내 인증 모듈
 *          ◀── 인코딩된 페이로드(encoded) ──
 *   브라우저 ──POST /api/auth/sso { encoded } ──▶ Next 서버
 *                                                 decodeSsoPayload(encoded)
 *                                                 → DecodedUser → 세션 쿠키
 *
 * 이 파일의 타입은 실구현으로 교체할 때도 그대로 유지된다.
 * 실제로 채워 넣어야 할 곳은 client.ts 와 decode.ts 두 개뿐이다.
 */

/** 로그인 화면에 표시되는 4단계 (디자인 AUTH_STEPS, 원본 1682행) */
export const AUTH_STEPS = [
  "Tray 인증 모듈 연결",
  "SSO 토큰 요청",
  "사내 계정 확인",
  "구독 정보 동기화",
] as const;

export type AuthStepIndex = 0 | 1 | 2 | 3;

export type SsoFailureCode =
  | "SSO_TRAY_NOT_RUNNING"
  | "SSO_TRAY_NOT_INSTALLED"
  | "SSO_TIMEOUT_30S";

export interface SsoFailureCheck {
  /** 항목 제목 */
  t: string;
  /** 설명 */
  d: string;
}

export interface SsoFailure {
  code: SsoFailureCode;
  title: string;
  desc: string;
  checks: SsoFailureCheck[];
}

/** SSO 실패를 나타내는 예외. 로그인 화면이 code 로 안내 문구를 고른다. */
export class SsoError extends Error {
  readonly code: SsoFailureCode;

  constructor(code: SsoFailureCode, message?: string) {
    super(message ?? code);
    this.name = "SsoError";
    this.code = code;
  }
}

/** 트레이 모듈이 최종적으로 돌려주는 값. 서버가 디코딩한다. */
export interface SsoTrayPayload {
  encoded: string;
}

/** 서버 디코딩 결과 — 세션에 담을 사용자 정보 */
export interface DecodedUser {
  empNo: string;
  name: string;
  email?: string | null;
  dept?: string | null;
}

/** 진행 상황 콜백 */
export type SsoProgress = (step: AuthStepIndex) => void;

export interface SsoClient {
  /**
   * 트레이 모듈에 자동 로그인을 요청한다.
   * 단계가 진행될 때마다 onProgress(i) 를 호출하고, 최종적으로 인코딩된
   * 페이로드를 돌려준다. 실패 시 SsoError 를 던진다.
   */
  authenticate(onProgress: SsoProgress, signal: AbortSignal): Promise<SsoTrayPayload>;
}

/** 자동 로그인 최대 대기 시간 — 디자인 문구 "최대 30초" 와 맞춘다. */
export const SSO_TIMEOUT_MS = 30_000;
