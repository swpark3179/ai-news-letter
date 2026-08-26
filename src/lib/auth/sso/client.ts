import { ssoPublicEnv } from "@/lib/env";
import { buildKnoxRequest, parseTrayFrame } from "./tray-protocol";
import {
  SSO_TIMEOUT_MS,
  SsoError,
  type SsoClient,
  type SsoFailureCode,
  type SsoProgress,
  type SsoTrayPayload,
} from "./types";

/* ===========================================================================
 * 사내 SSO Tray WebSocket 클라이언트 (Knox getknoxsso)
 * ===========================================================================
 *
 * 대화는 한 번의 왕복이 전부다. 레거시 ssoLogin.js 와 같은 규격이다.
 *
 *   open → {"rqtype":"getknoxsso","token":"","data":"<앱코드>"} → 응답 1건 → close
 *
 * 진행 표시는 0·1·2 만 낸다. 3(구독 정보 동기화)은 서버 왕복이라 LoginClient 가
 * 켠다 — 트레이는 메시지를 한 번만 보내므로 여기서 3까지 부르면 없는 단계를
 * 지어내는 것이 된다.
 *
 *   0 Tray 인증 모듈 연결   — WebSocket open
 *   1 SSO 토큰 요청         — 요청 메시지 전송 완료
 *   2 사내 계정 확인        — userInfo·key 가 든 프레임 수신
 *   3 구독 정보 동기화      — (LoginClient) POST /api/auth/sso 직전
 *
 * 메시지 규격 자체는 tray-protocol.ts 에 있다. 이 파일은 소켓 수명과 실패 분류만
 * 맡는다.
 * ------------------------------------------------------------------------ */

export class KnoxTraySsoClient implements SsoClient {
  private readonly url: string;
  private readonly appCode: string;

  constructor(
    url: string = ssoPublicEnv.trayWsUrl,
    appCode: string = ssoPublicEnv.trayAppCode,
  ) {
    this.url = url;
    this.appCode = appCode;
  }

  authenticate(onProgress: SsoProgress, signal: AbortSignal): Promise<SsoTrayPayload> {
    // 배포 설정 누락은 사용자가 고칠 수 없는 문제다. 「설치하세요」로 오해시키지 않는다.
    if (!this.url) {
      return Promise.reject(
        new SsoError(
          "SSO_CONFIG_MISSING",
          "NEXT_PUBLIC_SSO_TRAY_WS_URL 이 설정되지 않았습니다.",
        ),
      );
    }
    if (!this.appCode) {
      return Promise.reject(
        new SsoError(
          "SSO_CONFIG_MISSING",
          "NEXT_PUBLIC_SSO_TRAY_APP_CODE 가 설정되지 않았습니다. " +
            "(레거시 교육포털 예시값 KCC60TRAY0109 — 이 서비스용 코드를 발급받아야 합니다.)",
        ),
      );
    }

    return new Promise<SsoTrayPayload>((resolve, reject) => {
      let settled = false;
      /** open 이벤트를 한 번이라도 받았는지 — 실패 원인을 가르는 기준이다. */
      let opened = false;
      let ws: WebSocket | null = null;

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

      const timer = setTimeout(() => {
        // 열리지도 못한 채 30초가 지났다면 지연이 아니라 모듈이 없는 것이다.
        // 「사내망 · VPN 을 확인하세요」로 엉뚱한 곳을 보게 만들지 않는다.
        if (opened) {
          fail("SSO_TIMEOUT_30S", "트레이가 30초 안에 응답하지 않았습니다.");
        } else {
          fail("SSO_TRAY_NOT_RUNNING", "30초 동안 인증 모듈에 연결하지 못했습니다.");
        }
      }, SSO_TIMEOUT_MS);

      const onAbort = () => finish(() => reject(new DOMException("Aborted", "AbortError")));
      signal.addEventListener("abort", onAbort);

      try {
        ws = new WebSocket(this.url);
      } catch {
        fail("SSO_TRAY_NOT_RUNNING", "WebSocket 연결을 열 수 없습니다.");
        return;
      }

      const socket = ws;

      socket.onopen = () => {
        opened = true;
        onProgress(0);
        socket.send(buildKnoxRequest(this.appCode));
        onProgress(1);
      };

      socket.onmessage = (ev: MessageEvent) => {
        const frame = parseTrayFrame(ev.data);
        switch (frame.kind) {
          case "ignore":
            return; // 규격 밖 프레임은 버리고 계속 기다린다
          case "error":
            fail("SSO_TRAY_NOT_RUNNING", frame.message);
            return;
          case "result":
            onProgress(2);
            finish(() =>
              resolve({
                kind: "knox",
                userInfo: frame.value.userInfo,
                privateKey: frame.value.key,
              }),
            );
            return;
        }
      };

      // 브라우저는 「모듈이 안 떠 있다」와 「인증서를 못 믿는다」를 구분해 주지
      // 않는다 — 둘 다 열리기 전 error/close 로만 나타난다. 그래서 두 경우를 같은
      // 코드로 묶고, 안내 카드(failures.ts)에 인증서 확인 항목을 함께 넣어 두었다.
      socket.onerror = () =>
        fail(
          "SSO_TRAY_NOT_RUNNING",
          opened
            ? "인증 모듈과 통신하는 중 오류가 발생했습니다."
            : "인증 모듈에 연결하지 못했습니다. 모듈 실행 여부와 로컬 인증서 신뢰를 확인하세요.",
        );

      socket.onclose = (ev: CloseEvent) =>
        fail(
          "SSO_TRAY_NOT_RUNNING",
          opened
            ? `응답을 받기 전에 연결이 끊겼습니다. (code ${ev.code})`
            : `인증 모듈이 연결을 거부했습니다. (code ${ev.code})`,
        );
    });
  }
}
