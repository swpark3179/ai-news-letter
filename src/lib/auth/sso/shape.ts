/**
 * SSO 페이로드 「모양」 분석.
 *
 * 값을 드러내지 않고 규격만 추정한다. 트레이가 준 userInfo·key 가
 *   · web-safe base64 인가 (레거시 파라미터명이 wb64str 였다)
 *   · 이미 평문 JSON·쿼리스트링인가
 *   · 중간에서 잘리거나 공백이 섞였는가
 * 를 가려내는 것이 목적이다. 어느 복호화 전략을 시도해야 하는지, 또 「전달 과정이
 * 깨진 것」인지 「복호화 규격이 틀린 것」인지가 여기서 갈린다.
 *
 * **브라우저와 서버 양쪽에서 돌아야 하므로 Buffer·atob 를 쓰지 않는다.**
 * 실제 디코딩은 서버(decode-knox.ts)가 하고, 이 파일은 문자열 검사만 한다.
 */

export type FieldForm =
  | "empty"
  | "json"
  | "querystring"
  | "base64url"
  | "base64"
  | "hex"
  | "opaque";

export interface FieldShape {
  length: number;
  form: FieldForm;
  /**
   * base64 로 **가능한** 길이인지.
   *
   * 길이 %4 가 1 인 문자열은 base64 로 만들어질 수 없다 — 전달 중에 잘린 것이다.
   * 2·3 은 패딩(=)을 뗀 정상 형태다. 그래서 「%4 가 0인가」로 보면 정상인 값을
   * 잘렸다고 오진한다.
   */
  base64Possible: boolean;
  /** 패딩이 떼어진 형태인지 (길이 %4 가 2 또는 3) */
  base64Unpadded: boolean;
  /** `-` `_` 가 쓰였는지 — web-safe base64 의 표식 */
  webSafeChars: boolean;
  /** 공백·개행이 섞였는지 — 「무변형 전달」이 깨졌다는 신호 */
  hasWhitespace: boolean;
  /** 앞뒤 몇 글자. 짧은 값은 통째로 드러나므로 아예 비운다. */
  head: string;
  tail: string;
}

const B64URL = /^[A-Za-z0-9\-_]+={0,2}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const HEX = /^[0-9a-fA-F]+$/;
/** decode-knox.ts 의 parseClaims 와 같은 판정식 */
const QUERY = /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/;

/** 이 길이 이하는 앞뒤 미리보기를 내지 않는다 (통째로 드러나므로). */
const PREVIEW_MIN = 24;

export function analyzeField(raw: string): FieldShape {
  const t = raw.trim();
  const rem = t.length % 4;
  const base: FieldShape = {
    length: raw.length,
    form: "opaque",
    base64Possible: rem !== 1,
    base64Unpadded: rem === 2 || rem === 3,
    webSafeChars: /[-_]/.test(t),
    hasWhitespace: /\s/.test(raw),
    head: raw.length > PREVIEW_MIN ? raw.slice(0, 8) : "",
    tail: raw.length > PREVIEW_MIN ? raw.slice(-4) : "",
  };

  if (t.length === 0) return { ...base, form: "empty" };
  if (t.startsWith("{") || t.startsWith("[")) return { ...base, form: "json" };
  if (B64URL.test(t) && /[-_]/.test(t)) return { ...base, form: "base64url" };
  // 16진 판정을 base64 보다 먼저 한다 — 16진 문자열은 base64 알파벳의 부분집합이다.
  if (HEX.test(t) && t.length % 2 === 0) return { ...base, form: "hex" };
  // 여기까지 왔으면 -_ 도 없다. 표준·web-safe 를 구분할 근거가 없으므로 base64 로 적는다.
  if (B64URL.test(t) || B64.test(t)) return { ...base, form: "base64" };
  if (QUERY.test(t)) return { ...base, form: "querystring" };
  return base;
}

const FORM_LABEL: Record<FieldForm, string> = {
  empty: "빈 값",
  json: "평문 JSON",
  querystring: "평문 쿼리스트링",
  base64url: "web-safe base64 (-_ 포함)",
  base64: "base64 (공용 문자만 — 표준·web-safe 구분 불가)",
  hex: "16진 문자열",
  opaque: "분류 안 됨",
};

export function formLabel(form: FieldForm): string {
  return FORM_LABEL[form];
}

/** 진단 화면·복사용 한 줄 요약. */
export function describeShape(s: FieldShape): string {
  if (s.form === "empty") return "빈 값";

  const notes: string[] = [`${s.length}자`, formLabel(s.form)];
  if (s.form === "base64url" || s.form === "base64" || s.form === "hex") {
    if (!s.base64Possible) {
      notes.push("자릿수 불가 — 전달 중 잘렸습니다");
    } else if (s.base64Unpadded) {
      notes.push("패딩 없는 형태(정상)");
    } else {
      notes.push("자릿수 정상");
    }
  }
  if (s.hasWhitespace) notes.push("공백·개행 포함");
  if (s.head) notes.push(`${s.head}…${s.tail}`);
  return notes.join(" · ");
}
