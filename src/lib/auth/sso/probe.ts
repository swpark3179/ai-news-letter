import { buildKnoxRequest, parseTrayFrame } from "./tray-protocol";
import { SSO_TIMEOUT_MS, type SsoFailureCode, type SsoTrayPayload } from "./types";

/* ===========================================================================
 * 2단계 — 트레이 핸드셰이크 관찰용 클라이언트 (브라우저)
 * ===========================================================================
 *
 * client.ts(KnoxTraySsoClient)와 같은 대화를 하지만 목적이 다르다.
 *
 *   client.ts  실패를 **분류**한다 — 화면에 안내 카드를 띄우기 위해 원인을 5종으로 접는다.
 *   probe.ts   실패를 **기록**한다 — 접기 전의 사실을 순서대로 남긴다.
 *
 * 접는 과정에서 사라지는 정보가 바로 디버깅에 필요한 것들이다.
 *   · 소켓이 열렸는지 (열리기 전 실패면 「모듈 미실행」과 「인증서 불신」이 같아진다)
 *   · close code (1006 = 핸드셰이크 실패 · 1000 = 정상 종료 후 응답 없음)
 *   · 규격 밖이라 **조용히 버려진** 프레임과 그 이유 (production 은 계속 기다린다)
 *   · 각 단계까지 걸린 시간
 *
 * 판정 자체는 parseTrayFrame 을 그대로 쓴다 — 진단이 production 과 다른 규칙으로
 * 판단하면 진단의 의미가 없다.
 * ------------------------------------------------------------------------ */

export type ProbeEventKind =
  | "config"
  | "connecting"
  | "open"
  | "sent"
  | "frame"
  | "ignored"
  | "result"
  | "error"
  | "close"
  | "timeout"
  | "done";

export interface ProbeEvent {
  /** 시작 시점 기준 경과 ms */
  atMs: number;
  kind: ProbeEventKind;
  text: string;
  /** 트레이가 보낸 원문. 암호문이 들어 있어 화면은 기본적으로 가린다. */
  raw?: string;
}

export interface ProbeResult {
  url: string;
  appCode: string;
  events: ProbeEvent[];
  /** open 이벤트를 한 번이라도 받았는지 — 실패 원인을 가르는 기준 */
  opened: boolean;
  /** 보낸 요청 프레임 (앱 코드 확인용, 비밀 아님) */
  request: string;
  /** 규격에 맞는 응답을 받았다면 서버로 넘길 페이로드 */
  payload: SsoTrayPayload | null;
  failure: { code: SsoFailureCode; message: string } | null;
  closeCode: number | null;
  elapsedMs: number;
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * 트레이에 한 번 물어보고 오간 것을 전부 기록한다.
 *
 * 로그인 화면과 달리 **세션을 만들지 않는다.** 받은 페이로드는 결과에만 담기고,
 * 3단계(서버 드라이런)로 넘길지는 사용자가 고른다.
 */
export function probeTray(opts: {
  url: string;
  appCode: string;
  timeoutMs?: number;
  onEvent?: (e: ProbeEvent) => void;
}): Promise<ProbeResult> {
  const { url, appCode, timeoutMs = SSO_TIMEOUT_MS, onEvent } = opts;
  const t0 = now();
  const events: ProbeEvent[] = [];
  const request = buildKnoxRequest(appCode);

  const log = (kind: ProbeEventKind, text: string, raw?: string) => {
    const e: ProbeEvent = { atMs: Math.round(now() - t0), kind, text, raw };
    events.push(e);
    onEvent?.(e);
  };

  return new Promise<ProbeResult>((resolve) => {
    let settled = false;
    let opened = false;
    let closeCode: number | null = null;
    let ws: WebSocket | null = null;

    const done = (
      payload: SsoTrayPayload | null,
      failure: ProbeResult["failure"],
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        /* 이미 닫혔으면 무시 */
      }
      log("done", payload ? "페이로드 확보 — 3단계로 넘길 수 있습니다." : "종료");
      resolve({
        url,
        appCode,
        events,
        opened,
        request,
        payload,
        failure,
        closeCode,
        elapsedMs: Math.round(now() - t0),
      });
    };

    log("config", `주소 ${url || "(비어 있음)"} · 앱 코드 ${appCode || "(비어 있음)"}`);

    if (!url || !appCode) {
      log("error", "주소나 앱 코드가 비어 있어 시도하지 않았습니다.");
      done(null, {
        code: "SSO_CONFIG_MISSING",
        message:
          "NEXT_PUBLIC_SSO_TRAY_WS_URL · NEXT_PUBLIC_SSO_TRAY_APP_CODE 를 채우고 재배포해야 합니다.",
      });
      return;
    }
    if (typeof WebSocket === "undefined") {
      log("error", "이 환경에는 WebSocket 이 없습니다.");
      done(null, { code: "SSO_TRAY_NOT_INSTALLED", message: "WebSocket 을 쓸 수 없습니다." });
      return;
    }

    const timer = setTimeout(() => {
      log("timeout", `${timeoutMs}ms 안에 끝나지 않았습니다. (소켓 열림: ${opened})`);
      done(
        null,
        opened
          ? { code: "SSO_TIMEOUT_30S", message: "소켓은 열렸지만 응답 프레임이 오지 않았습니다." }
          : {
              code: "SSO_TRAY_NOT_RUNNING",
              message:
                "소켓이 열리지도 못했습니다. 모듈 미실행 · 포트 불일치 · 로컬 인증서 불신 중 하나입니다.",
            },
      );
    }, timeoutMs);

    log("connecting", "WebSocket 연결 시도");
    try {
      ws = new WebSocket(url);
    } catch (e) {
      log("error", `WebSocket 생성 실패: ${e instanceof Error ? e.message : "알 수 없음"}`);
      done(null, {
        code: "SSO_TRAY_NOT_RUNNING",
        message: "주소 형식이 잘못됐거나 연결을 열 수 없습니다.",
      });
      return;
    }

    const socket = ws;

    socket.onopen = () => {
      opened = true;
      log("open", "소켓이 열렸습니다 — 모듈이 실행 중이고 인증서도 수락됐습니다.");
      socket.send(request);
      log("sent", `요청 전송: ${request}`);
    };

    socket.onmessage = (ev: MessageEvent) => {
      const raw = typeof ev.data === "string" ? ev.data : `(${typeof ev.data})`;
      log("frame", `프레임 수신 (${raw.length}자)`, raw);

      const frame = parseTrayFrame(ev.data);
      switch (frame.kind) {
        case "ignore":
          // production 은 이것을 조용히 버리고 계속 기다린다 — 그 조용함이 문제다.
          log("ignored", `버려짐: ${frame.reason} (production 도 같은 판정으로 계속 기다립니다)`);
          return;
        case "error":
          log("error", `트레이가 오류를 돌려주었습니다: ${frame.message}`);
          done(null, { code: "SSO_TRAY_NOT_RUNNING", message: frame.message });
          return;
        case "result":
          log(
            "result",
            `규격에 맞는 응답 — rqtype=${frame.value.rqtype ?? "(없음)"} · result=${frame.value.result ?? "(없음)"} · userInfo ${frame.value.userInfo.length}자 · key ${frame.value.key.length}자`,
          );
          done(
            {
              kind: "knox",
              userInfo: frame.value.userInfo,
              privateKey: frame.value.key,
            },
            null,
          );
          return;
      }
    };

    // 브라우저는 「모듈이 안 떠 있다」와 「인증서를 못 믿는다」를 구분해 주지 않는다.
    // 여기서는 최소한 「열리기 전이었는지」를 남겨 둔다.
    socket.onerror = () => {
      log(
        "error",
        opened
          ? "통신 중 오류 (열린 뒤)"
          : "연결 오류 (열리기 전) — 모듈 미실행 · 포트 불일치 · 인증서 불신을 구분할 수 없습니다. 주소를 새 탭에서 한 번 열어 인증서를 수락해 보세요.",
      );
    };

    socket.onclose = (ev: CloseEvent) => {
      closeCode = ev.code;
      log(
        "close",
        `연결 종료 code=${ev.code}${ev.reason ? ` reason=${ev.reason}` : ""} · ${closeCodeHint(ev.code, opened)}`,
      );
      done(null, {
        code: "SSO_TRAY_NOT_RUNNING",
        message: opened
          ? `응답을 받기 전에 연결이 끊겼습니다. (code ${ev.code})`
          : `연결이 거부됐습니다. (code ${ev.code})`,
      });
    };
  });
}

/** close code 를 사람이 읽을 수 있는 원인 후보로. */
function closeCodeHint(code: number, opened: boolean): string {
  if (code === 1000) {
    return opened
      ? "정상 종료 — 트레이가 응답 없이 닫았습니다. 앱 코드가 등록되지 않은 경우일 수 있습니다."
      : "정상 종료";
  }
  if (code === 1006) {
    return "비정상 종료 — 핸드셰이크 자체가 실패했습니다. 모듈 미실행 · 포트 불일치 · TLS 인증서 불신이 모두 이 코드로 옵니다.";
  }
  if (code === 1015) return "TLS 핸드셰이크 실패 — 로컬 인증서를 신뢰하지 않습니다.";
  if (code === 1002 || code === 1003) return "프로토콜·데이터 형식 오류";
  if (code >= 4000) return "트레이 모듈이 지정한 종료 코드입니다 — 담당자에게 의미를 문의하세요.";
  return "";
}

/** 이벤트 로그를 붙여 넣기 좋은 텍스트로. [raw] 를 켜면 원문까지 담는다. */
export function probeToText(r: ProbeResult, includeRaw = false): string {
  const lines = [
    `# 트레이 핸드셰이크 — ${r.url}`,
    `앱 코드 ${r.appCode} · 소켓 열림 ${r.opened ? "예" : "아니오"} · close ${r.closeCode ?? "(없음)"} · ${r.elapsedMs}ms`,
    "",
  ];
  for (const e of r.events) {
    lines.push(`${String(e.atMs).padStart(6)}ms [${e.kind}] ${e.text}`);
    if (includeRaw && e.raw) lines.push(`         원문: ${e.raw}`);
  }
  if (r.failure) lines.push("", `실패: ${r.failure.code} — ${r.failure.message}`);
  if (r.payload) lines.push("", "결과: 규격에 맞는 페이로드를 받았습니다.");
  return lines.join("\n");
}
