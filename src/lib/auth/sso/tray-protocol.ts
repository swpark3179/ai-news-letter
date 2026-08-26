/**
 * Knox SSO 트레이 프레임 조립·해석.
 *
 * DOM 을 쓰지 않는 순수 함수만 둔다 — WebSocket 없이도 캡처한 프레임 문자열로
 * 검증할 수 있어야 하고, 실제 규격이 조금씩 달라도 이 파일 하나만 고치면 되게
 * 하려는 것이다.
 *
 * 트레이가 보내는 것 (레거시 ssoLogin.js 가 받던 형태)
 *
 *   {"rqtype":"getknoxsso","result":"success",
 *    "data":{"userInfo":"<문자열>","key":"<문자열>"}}
 *
 * userInfo·key 는 「문자열 안에 든 JSON」일 수도, 그냥 암호문일 수도 있다.
 *
 * ── 레거시 파싱을 그대로 옮기지 않는 이유 ──────────────────────────────────
 *
 *   JSON.stringify(event.data).replace(/\\/g,'').replace(/"\{/g,'{').replace(/\}"/g,'}')
 *
 * event.data 는 **이미 문자열**이라 JSON.stringify 가 이스케이프를 한 겹 더 씌운다
 * (" → \" , 원래 있던 \" → \\\"). 거기서 백슬래시를 전부 지우면 두 겹이 한꺼번에
 * 풀리고, "{ 와 }" 를 { 와 } 로 바꾸면 중첩된 JSON 문자열이 객체 리터럴이 된다.
 * 즉 하려던 일은 「바깥 JSON 을 파싱하고 안쪽 JSON 문자열을 한 번 더 파싱한다」이고,
 * 그것을 문자열 치환으로 흉내 낸 것이다.
 *
 * 그 방식은 값에 백슬래시가 하나라도 들어가면(\n · \uXXXX · 이름 속 따옴표)
 * 예외 없이 **조용히** 깨지고, 암호문이라면 원문이 훼손된다.
 *
 * 여기서는 두 가지를 지킨다.
 *   · 바깥 프레임은 JSON.parse 로 한 번만 판다. data 가 문자열이면 딱 한 번 더.
 *   · userInfo·key 는 **한 글자도 바꾸지 않고** 그대로 꺼낸다. 해석은 서버 몫이다.
 * ------------------------------------------------------------------------ */

export interface KnoxTrayResult {
  userInfo: string;
  key: string;
  /** 진단용 — 트레이가 보내 준 값 그대로 */
  rqtype: string | null;
  result: string | null;
}

export type TrayFrame =
  | { kind: "result"; value: KnoxTrayResult }
  | { kind: "error"; code: string | null; message: string }
  | { kind: "ignore"; reason: string };

export const KNOX_RQTYPE = "getknoxsso";

/**
 * 레거시와 같은 3개 필드로 요청을 만든다.
 *   {"rqtype":"getknoxsso","token":"","data":"<앱코드>"}
 * token 은 레거시에서도 빈 문자열이었다.
 */
export function buildKnoxRequest(appCode: string): string {
  return JSON.stringify({ rqtype: KNOX_RQTYPE, token: "", data: appCode });
}

/** 성공을 뜻하는 result 값. 철자가 확정되지 않아 넉넉히 받는다. */
const OK_RESULT = /^(0+|200|ok|okay|success|succeed|true|y|yes)$/i;

export function parseTrayFrame(raw: unknown): TrayFrame {
  if (typeof raw !== "string") {
    return { kind: "ignore", reason: "문자열이 아닌 프레임(Blob/ArrayBuffer)" };
  }

  const root = parseJsonObject(raw);
  if (!root) return { kind: "ignore", reason: "JSON 객체가 아님" };

  // 같은 소켓으로 다른 요청의 응답이 올 수 있다. 우리 것만 받는다.
  const rqtype = asString(root.rqtype);
  if (rqtype && rqtype !== KNOX_RQTYPE) {
    return { kind: "ignore", reason: `다른 rqtype: ${rqtype}` };
  }

  const result = asString(root.result) ?? asString(root.resultCode) ?? asString(root.rsCode);
  if (result && !OK_RESULT.test(result)) {
    return {
      kind: "error",
      code: result,
      message:
        asString(root.message) ?? asString(root.msg) ?? asString(root.rsMsg) ??
        `트레이가 오류를 돌려주었습니다. (${result})`,
    };
  }

  // data 가 객체일 수도, JSON 문자열일 수도 있다. 문자열이면 한 번만 더 판다.
  const data = asRecord(root.data) ?? parseJsonObject(asString(root.data) ?? "");
  if (!data) {
    // 성공 표시만 있고 data 가 아직 안 온 예고 프레임일 수 있으므로 끊지 않는다.
    return { kind: "ignore", reason: "data 없음" };
  }

  const userInfo = relay(data.userInfo);
  const key = relay(data.key ?? data.privateKey);
  if (!userInfo || !key) {
    return { kind: "error", code: null, message: "인증 응답에 userInfo · key 가 없습니다." };
  }

  return { kind: "result", value: { userInfo, key, rqtype, result } };
}

/**
 * 서버로 그대로 넘길 값을 꺼낸다.
 *
 * 문자열이면 **손대지 않는다** — 암호문일 수 있어 trim 조차 하면 안 된다.
 * 트레이가 객체로 준 경우에만 JSON 문자열로 되돌린다.
 */
function relay(v: unknown): string | null {
  if (typeof v === "string") return v.length > 0 ? v : null;
  if (v && typeof v === "object") return JSON.stringify(v);
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function parseJsonObject(s: string): Record<string, unknown> | null {
  const t = s.trim();
  if (!t.startsWith("{")) return null;
  try {
    return asRecord(JSON.parse(t));
  } catch {
    return null;
  }
}
