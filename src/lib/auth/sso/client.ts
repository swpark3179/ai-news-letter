import { ssoPublicEnv } from "@/lib/env";
import {
  SSO_TIMEOUT_MS,
  SsoError,
  type AuthStepIndex,
  type SsoClient,
  type SsoFailureCode,
  type SsoProgress,
  type SsoTrayPayload,
} from "./types";

/* ===========================================================================
 * ★ 실구현 자리 — 사내 SSO Tray WebSocket 클라이언트
 * ===========================================================================
 *
 * 아래 골격은 "연결 → 요청 → 응답 수신 → encoded 반환"이라는 형태만 잡아 둔
 * 것이고, 실제 메시지 규격은 사내 인증 모듈 문서에 맞춰 채워야 한다.
 * 바꿔야 할 지점을 TODO 로 표시했다. 이 파일 밖의 코드는 손댈 필요가 없다.
 *
 * 필요한 정보
 *   1. WebSocket 주소            → NEXT_PUBLIC_SSO_TRAY_WS_URL (예: wss://127.0.0.1:8443)
 *   2. 핸드셰이크 메시지 규격     → HANDSHAKE 상수
 *   3. 서버가 보내는 메시지 타입   → onmessage 의 분기
 *   4. 최종 페이로드 필드명       → encoded 를 꺼내는 부분
 *
 * 4단계 진행 표시(onProgress)는 화면의 체크리스트와 1:1로 대응한다.
 *   0 Tray 인증 모듈 연결   — WebSocket open
 *   1 SSO 토큰 요청         — 요청 메시지 전송 완료
 *   2 사내 계정 확인        — 서버가 계정 확인 응답을 보냄
 *   3 구독 정보 동기화      — 최종 페이로드 수신 직전
 * ------------------------------------------------------------------------ */

/** TODO(사내연동): 실제 핸드셰이크 규격으로 교체 */
const HANDSHAKE = { type: "auth-request", app: "ai-newsletter", version: 1 };

interface TrayMessage {
  type?: string;
  /** TODO(사내연동): 실제 페이로드 필드명으로 교체 */
  payload?: string;
  encoded?: string;
  code?: string;
  message?: string;
}

export class WebSocketSsoClient implements SsoClient {
  private readonly url: string;

  constructor(url: string = ssoPublicEnv.trayWsUrl) {
    this.url = url;
  }

  authenticate(onProgress: SsoProgress, signal: AbortSignal): Promise<SsoTrayPayload> {
    if (!this.url) {
      // 주소가 없으면 모듈이 설치되지 않은 것으로 간주한다.
      return Promise.reject(
        new SsoError(
          "SSO_TRAY_NOT_INSTALLED",
          "NEXT_PUBLIC_SSO_TRAY_WS_URL 이 설정되지 않았습니다.",
        ),
      );
    }

    return new Promise<SsoTrayPayload>((resolve, reject) => {
      let settled = false;
      let ws: WebSocket;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        try {
          ws?.close();
        } catch {
          /* 이미 닫혔으면 무시 */
        }
        fn();
      };

      const fail = (code: SsoFailureCode, msg?: string) =>
        finish(() => reject(new SsoError(code, msg)));

      const timer = setTimeout(
        () => fail("SSO_TIMEOUT_30S", "인증 서버 응답 대기 시간 초과"),
        SSO_TIMEOUT_MS,
      );

      const onAbort = () => finish(() => reject(new DOMException("Aborted", "AbortError")));
      signal.addEventListener("abort", onAbort);

      try {
        ws = new WebSocket(this.url);
      } catch {
        fail("SSO_TRAY_NOT_RUNNING", "WebSocket 연결을 열 수 없습니다.");
        return;
      }

      ws.onopen = () => {
        onProgress(0);
        // TODO(사내연동): 규격에 맞는 핸드셰이크/인증 요청 전송
        ws.send(JSON.stringify(HANDSHAKE));
        onProgress(1);
      };

      ws.onmessage = (ev: MessageEvent) => {
        let msg: TrayMessage;
        try {
          msg = typeof ev.data === "string" ? JSON.parse(ev.data) : {};
        } catch {
          return; // 규격 외 메시지는 무시
        }

        // TODO(사내연동): 실제 메시지 타입에 맞게 분기 수정
        switch (msg.type) {
          case "account-verified":
            onProgress(2);
            return;

          case "auth-result": {
            const encoded = msg.encoded ?? msg.payload;
            if (!encoded) {
              fail("SSO_TRAY_NOT_RUNNING", "인증 응답에 페이로드가 없습니다.");
              return;
            }
            onProgress(3);
            finish(() => resolve({ encoded }));
            return;
          }

          case "auth-error":
            fail(
              msg.code === "NOT_INSTALLED"
                ? "SSO_TRAY_NOT_INSTALLED"
                : "SSO_TRAY_NOT_RUNNING",
              msg.message,
            );
            return;

          default:
            return;
        }
      };

      // 연결 자체가 거부되면 트레이 모듈이 떠 있지 않은 것이다.
      ws.onerror = () => fail("SSO_TRAY_NOT_RUNNING", "인증 모듈에 연결하지 못했습니다.");
      ws.onclose = () => fail("SSO_TRAY_NOT_RUNNING", "인증 모듈 연결이 끊겼습니다.");
    });
  }
}

/** 진행 단계 라벨 인덱스 검증용 */
export function asStepIndex(n: number): AuthStepIndex {
  return Math.min(3, Math.max(0, n)) as AuthStepIndex;
}
