import { MOCK_USER } from "./mock-user";
import {
  SsoError,
  type SsoClient,
  type SsoFailureCode,
  type SsoProgress,
  type SsoTrayPayload,
} from "./types";

/**
 * 목업 SSO 클라이언트.
 *
 * 실제 트레이 모듈 없이 로그인 화면 전체(4단계 진행 → 성공/실패 → 사번 폴백)를
 * 확인할 수 있게 한다. 실 클라이언트가 들어온 뒤에도 index.ts 가 모드로 분기하므로
 * 이 파일은 개발/테스트용으로 그대로 남는다.
 *
 * 실패 시나리오 강제
 *   /login?fail=SSO_TRAY_NOT_RUNNING
 *   /login?fail=SSO_TRAY_NOT_INSTALLED
 *   /login?fail=SSO_TIMEOUT_30S
 */

/**
 * 단계별 소요 시간 (ms). 합계 약 1.8초.
 *
 * 세 개인 이유: 4번째 단계(구독 정보 동기화)는 서버 왕복이라 LoginClient 가
 * 켠다. 실 클라이언트와 진행 표시의 소유권을 똑같이 맞춰 둔다.
 */
const STEP_DELAYS = [420, 620, 780];

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class MockSsoClient implements SsoClient {
  private readonly forcedFailure: SsoFailureCode | null;

  constructor(forcedFailure: SsoFailureCode | null = null) {
    this.forcedFailure = forcedFailure;
  }

  async authenticate(
    onProgress: SsoProgress,
    signal: AbortSignal,
  ): Promise<SsoTrayPayload> {
    for (let i = 0; i < STEP_DELAYS.length; i++) {
      await sleep(STEP_DELAYS[i], signal);
      onProgress(i as 0 | 1 | 2);

      // 실패를 강제한 경우 2단계(사내 계정 확인)에서 끊는다.
      if (this.forcedFailure && i === 1) {
        // 타임아웃 시나리오는 실제로 잠깐 더 기다리는 편이 자연스럽다.
        if (this.forcedFailure === "SSO_TIMEOUT_30S") {
          await sleep(900, signal);
        }
        throw new SsoError(this.forcedFailure, "목업 강제 실패");
      }
    }

    // 서버 decode.ts 의 목업 구현이 읽을 수 있는 형태로 인코딩한다.
    const json = JSON.stringify({
      ...MOCK_USER,
      issuedAt: Date.now(),
      mock: true,
    });
    return { kind: "mock", encoded: `mock.${base64UrlEncode(json)}` };
  }
}

function base64UrlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
