import { KST_TZ } from "@/lib/env";

/**
 * 날짜/숫자 표기 헬퍼.
 *
 * 서버 렌더와 클라이언트 렌더가 갈리면 hydration 이 깨지므로 모든 함수가
 * timeZone 을 Asia/Seoul 로 못박는다. "지금"에 의존하는 relativeKo() 만
 * 예외적으로 클라이언트에서 쓰거나 서버에서 계산한 값을 넘겨받아 쓴다.
 */

const KO = "ko-KR";

function parts(d: Date, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(KO, { timeZone: KST_TZ, ...opts }).format(d);
}

export function toDate(v: string | number | Date): Date {
  return v instanceof Date ? v : new Date(v);
}

/** '2026년 8월 21일 금요일' — 1면 마스트헤드 */
export function longDateKo(v: string | number | Date): string {
  return parts(toDate(v), {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });
}

/** '8월 21일 (금)' */
export function shortDateKo(v: string | number | Date): string {
  const d = toDate(v);
  const md = parts(d, { month: "long", day: "numeric" });
  const w = parts(d, { weekday: "short" });
  return `${md} (${w})`;
}

/** '2026.08.21' — 기사 헤더 */
export function dotDate(v: string | number | Date): string {
  const d = toDate(v);
  const [y, m, day] = ymdParts(d);
  return `${y}.${m}.${day}`;
}

/** '08.21' — 섹션 목록 좌측 */
export function shortDot(v: string | number | Date): string {
  const [, m, day] = ymdParts(toDate(v));
  return `${m}.${day}`;
}

/** '0821' — 지면 번호 */
export function issueNum(v: string | number | Date): string {
  const [, m, day] = ymdParts(toDate(v));
  return `${m}${day}`;
}

/** 'HH:MM:SS' — 파이프라인 로그 타임스탬프 */
export function hhmmss(v: string | number | Date): string {
  return parts(toDate(v), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** ['2026', '08', '21'] — KST 기준 */
export function ymdParts(d: Date): [string, string, string] {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: KST_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, day] = f.format(d).split("-");
  return [y, m, day];
}

/** 'YYYY-MM-DD' (KST) — collected_date 비교용 */
export function kstDateString(v: string | number | Date = new Date()): string {
  return ymdParts(toDate(v)).join("-");
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' 이고 실제로 있는 날인가 — 주소창에서 온 값을 거르는 용도 */
export function isYmd(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const m = YMD.exec(v);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.toISOString().slice(0, 10) === v;
}

/** 'YYYY-MM-DD' 에 n 일을 더한다 (음수면 뺀다). 날짜만 다루므로 시간대가 끼지 않는다. */
export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** 긱뉴스 스타일 상대 시간: '10시간전' / '2일전' / '방금' */
export function relativeKo(
  v: string | number | Date,
  now: Date = new Date(),
): string {
  const diffSec = Math.floor((now.getTime() - toDate(v).getTime()) / 1000);
  if (diffSec < 60) return "방금";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}분전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간전`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}일전`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon}개월전`;
  return `${Math.floor(mon / 12)}년전`;
}

/** 1284 -> '1,284' */
export function comma(n: number): string {
  return n.toLocaleString(KO);
}

/** 발행 호수 — 기준일(창간)로부터의 발행 회차. app_settings.issue_no 를 보정용으로 쓴다. */
export function formatIssue(no: number): string {
  return `제 ${comma(no)}호`;
}
