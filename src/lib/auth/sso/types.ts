/**
 * 사내 SSO Tray 연동 타입.
 *
 * 흐름
 *   브라우저 ──WebSocket──▶ PC 트레이의 사내 인증 모듈 (Knox getknoxsso)
 *          ◀── { data: { userInfo, key } } ──
 *   브라우저 ──POST /api/auth/sso { kind:"knox", userInfo, privateKey } ──▶ Next 서버
 *                                                 decodeSsoPayload(payload)
 *                                                 → DecodedUser (EPID 포함)
 *                                                 → members 대조 → 세션 쿠키
 *
 * 실제 규격이 들어 있는 곳은 client.ts(브라우저) 와 decode-knox.ts(서버) 두 개다.
 */

/** 로그인 화면에 표시되는 4단계 (디자인 AUTH_STEPS, 원본 1682행) */
export const AUTH_STEPS = [
  "Tray 인증 모듈 연결",
  "SSO 토큰 요청",
  "사내 계정 확인",
  "구독 정보 동기화",
] as const;

/** 화면 체크리스트의 단계 인덱스 — AUTH_STEPS 와 1:1. */
export type AuthStepIndex = 0 | 1 | 2 | 3;

export type SsoFailureCode =
  | "SSO_TRAY_NOT_RUNNING"
  | "SSO_TRAY_NOT_INSTALLED"
  | "SSO_TIMEOUT_30S"
  /** 디코딩은 됐지만 EPID 가 members 에 없거나 비활성이다. 서버가 403 으로 돌려준다. */
  | "SSO_NOT_REGISTERED"
  /** 트레이 주소·앱코드 같은 배포 설정이 비어 있다. 사용자가 고칠 수 없는 문제다. */
  | "SSO_CONFIG_MISSING"
  /** 배포된 DB 에 코드가 기대하는 컬럼이 없다 (마이그레이션 미적용). 503 이다. */
  | "SSO_SCHEMA_OUTDATED";

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

/**
 * 서버 디코딩 실패. 라우트가 401 로 바꾼다.
 *
 * decode.ts 가 아니라 여기 두는 이유: decode.ts 와 decode-knox.ts 가 둘 다 던져야
 * 하는데, decode-knox.ts 를 decode.ts 에서 import 하므로 반대 방향 import 가
 * 순환이 된다. 기존 호출부(route.ts)를 위해 decode.ts 가 그대로 재수출한다.
 */
export class SsoDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsoDecodeError";
  }
}

/**
 * 트레이 모듈이 최종적으로 돌려주는 값. 서버가 디코딩한다.
 *
 * kind 로 갈라 두는 이유 두 가지.
 *   1. 실 프로토콜은 값이 둘(userInfo·key)이다. 하나로 합치려면 구분자를 새로
 *      발명해야 하는데, 두 값 모두 임의의 web-safe base64 라 안전한 구분자가 없다.
 *   2. 서버가 「지금 모드에 맞는 페이로드인가」를 확인할 수 있다. 실 모드에 목업
 *      페이로드가 들어오면 누구든 임의의 EPID 로 세션을 만들 수 있다 — decode.ts 참고.
 */
export type SsoTrayPayload =
  | { kind: "mock"; encoded: string }
  | { kind: "knox"; userInfo: string; privateKey: string };

/** 서버 디코딩 결과 — 세션에 담을 사용자 정보 */
export interface DecodedUser {
  /** 사내 SSO 사원 식별자. **등록사용자 대조의 기준값**이다. 사번과 다른 체계다. */
  epid: string;
  /** 사번. members.emp_no 와 맞춘다. EPID 를 아직 모르는 계정을 찾는 폴백에 쓰인다. */
  empNo: string;
  name: string;
  email?: string | null;
  dept?: string | null;
}

/**
 * 진행 상황 콜백.
 *
 * **클라이언트는 0·1·2 만 호출한다.** 3(구독 정보 동기화)은 서버 왕복이라
 * LoginClient 가 POST /api/auth/sso 직전에 직접 켠다. 트레이는 메시지를 한 번만
 * 보내므로, 클라이언트가 3까지 호출하면 없는 단계를 지어내는 셈이 된다.
 *
 * AuthStepIndex 에서 3을 빼는 식으로 적은 이유: 두 값을 따로 적어 두면 화면
 * 단계가 늘었을 때 한쪽만 고치고 지나가게 된다.
 */
export type SsoProgress = (step: Exclude<AuthStepIndex, 3>) => void;

export interface SsoClient {
  /**
   * 트레이 모듈에 자동 로그인을 요청한다.
   * 단계가 진행될 때마다 onProgress(i) 를 호출하고, 최종적으로 서버가 디코딩할
   * 페이로드를 돌려준다. 실패 시 SsoError 를 던진다.
   */
  authenticate(onProgress: SsoProgress, signal: AbortSignal): Promise<SsoTrayPayload>;
}

/** 자동 로그인 최대 대기 시간 — 디자인 문구 "최대 30초" 와 맞춘다. */
export const SSO_TIMEOUT_MS = 30_000;
