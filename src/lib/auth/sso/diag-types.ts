/**
 * 진단(디버깅) 자료구조 — 서버·브라우저 공용 타입.
 *
 * 구현은 두 곳으로 나뉜다.
 *   서버 : diagnostics.ts (환경변수·DB 확인, 드라이런 디코딩) — "server-only"
 *   화면 : app/login/diag  (단계 실행과 표시)
 *
 * 타입만 여기 따로 둔 이유: 클라이언트 컴포넌트가 diagnostics.ts 를 타입으로라도
 * 참조하면 "server-only" 모듈이 클라이언트 그래프에 얹혀 빌드가 깨진다.
 *
 * ── 이 진단이 답하려는 질문 ────────────────────────────────────────────────
 * 「SSO 로그인이 안 되는 것이 (A) 연동 로직 문제인가, (B) 로그인은 됐지만 환경변수가
 *  로드되지 않은 문제인가」. 그래서 모든 판정은 verdict.kind 로 그 둘을 가른다.
 *
 * ⚠ 이 타입에 담기는 값은 전부 **마스킹·모양 요약**이다. 복호화 키·서비스 롤 키·
 *   세션 시크릿 같은 비밀값은 존재 여부와 길이만 담는다.
 */

import { describeShape, type FieldShape } from "./shape";

/**
 * 진단 토큰을 실어 오는 헤더. 헤더가 먼저다 — URL 쿼리는 히스토리·리퍼러에 남는다.
 * (화면과 서버가 같은 이름을 봐야 하므로 공용 파일에 둔다.)
 */
export const DIAG_TOKEN_HEADER = "x-sso-debug-token";

export type DiagStatus = "ok" | "warn" | "fail" | "skip";

export interface DiagCheck {
  id: string;
  label: string;
  status: DiagStatus;
  /** 마스킹된 값 또는 모양 요약. 비밀값 자체는 절대 담지 않는다. */
  value: string;
  /** 이 결과가 뜻하는 것과 해야 할 일 */
  detail: string;
}

export interface DiagGroup {
  id: string;
  title: string;
  note?: string;
  checks: DiagCheck[];
}

/**
 * 진단의 결론.
 *
 *   config  — 환경변수·배포 설정 문제 (「변수 로드」 쪽)
 *   build   — 값은 있지만 빌드에 박힌 값이 달라 재배포가 필요한 경우
 *   logic   — 변수는 정상이고 연동 로직·규격 쪽 문제
 *   data    — members 등록·활성 상태 문제
 *   schema  — 코드가 기대하는 컬럼이 DB 에 없다 (마이그레이션 미적용)
 *   session — 인증은 통과했고 세션·쿠키 단계 문제
 *   ok      — 이 단계에서 막을 것이 없음
 *
 * data 와 schema 를 가르는 이유: 앞은 「행을 추가하세요」, 뒤는 「SQL 을 실행하세요」다.
 * 묶어 두면 화면을 보고 온 사람이 엉뚱한 곳을 고친다.
 */
export type DiagVerdictKind =
  | "config"
  | "build"
  | "logic"
  | "data"
  | "schema"
  | "session"
  | "ok";

export interface DiagVerdict {
  kind: DiagVerdictKind;
  status: DiagStatus;
  headline: string;
  /** 다음에 할 일 — 화면에 그대로 나열한다. */
  next: string[];
}

export interface SsoDiagSnapshot {
  at: string;
  /** 진단을 통과시킨 근거 */
  via: "dev" | "token" | "admin";
  runtime: {
    nodeEnv: string;
    nextRuntime: string;
    vercelEnv: string | null;
    region: string | null;
    serverTimeKst: string;
  };
  groups: DiagGroup[];
  verdict: DiagVerdict;
}

// ---------------------------------------------------------------------------
// 디코딩 추적 — decode-knox.ts 가 채우고 진단이 읽는다
// ---------------------------------------------------------------------------

export type DecodeOutcome =
  /** 이 전략으로 EPID 까지 얻었다 */
  | "adopted"
  /** 전제 조건이 없어 시도하지 못했다 (키 미설정 등) */
  | "skipped"
  /** 디코딩 결과가 텍스트·클레임으로 해석되지 않았다 */
  | "unreadable"
  /** 클레임은 나왔지만 EPID 로 볼 필드가 없었다 */
  | "no-epid"
  | "error";

export interface DecodeAttempt {
  strategy: string;
  outcome: DecodeOutcome;
  detail?: string;
  /** 해석된 클레임의 키 목록. **규격 확정에 가장 중요한 정보다.** */
  claimKeys?: string[];
}

/**
 * 무결성 미검증 페이로드 게이트(SSO_ALLOW_UNVERIFIED_PAYLOAD)의 상태.
 *
 *   open              — 통과 (개발·스테이징이거나 명시적으로 켠 운영)
 *   blocked           — 운영 빌드에서 거절됨. **실 모드 로그인이 여기서 멈춘다.**
 *   diagnostics-bypass— 진단 드라이런이라 게이트를 지나쳤다. 세션은 발급되지 않는다.
 */
export type DecodeGate = "open" | "blocked" | "diagnostics-bypass";

export interface DecodeTrace {
  kind: "mock" | "knox" | null;
  gate: DecodeGate;
  attempts: DecodeAttempt[];
  adopted: string | null;
}

export function newDecodeTrace(): DecodeTrace {
  return { kind: null, gate: "open", attempts: [], adopted: null };
}

// ---------------------------------------------------------------------------
// 드라이런 — 세션을 발급하지 않고 실제 경로를 그대로 밟아 본다
// ---------------------------------------------------------------------------

export interface MemberProbe {
  /** 어느 컬럼으로 찾았는지. resolveMemberFromSso 의 조회 순서와 같다. */
  matchedBy: "epid" | "emp_no" | null;
  found: boolean;
  isActive: boolean | null;
  role: string | null;
  isAdmin: boolean | null;
  /** 찾은 행의 epid 컬럼이 채워져 있는지 */
  epidFilled: boolean | null;
  /**
   * members.epid 컬럼 자체가 없다 (0012 미적용).
   *
   * epidFilled 와 다르다 — 앞은 「값이 비었다」, 이것은 「컬럼이 없다」다.
   * 이 값이 true 면 대조가 사번으로만 이뤄지므로 결과를 그대로 믿으면 안 된다.
   */
  epidColumnMissing: boolean;
  /** 로그인하면 EPID 백필이 일어나는지 */
  wouldBackfillEpid: boolean;
  /** 못 찾았을 때 자동 가입될지 (SSO_ALLOW_AUTO_CREATE) */
  wouldAutoCreate: boolean;
  error: string | null;
}

export interface SsoDryRun {
  at: string;
  mode: "mock" | "real";
  payloadKind: "mock" | "knox";
  /** 모드와 페이로드 종류가 맞는지 — 어긋나면 실제 라우트는 401 이다. */
  kindMatchesMode: boolean;
  shape: {
    userInfo?: FieldShape;
    privateKey?: FieldShape;
    encoded?: FieldShape;
  };
  trace: DecodeTrace;
  decoded: {
    ok: boolean;
    error: string | null;
    /** 마스킹된 값 — 어느 필드가 채워졌는지 보는 것이 목적이다. */
    epid: string | null;
    empNo: string | null;
    name: string | null;
    hasEmail: boolean;
    hasDept: boolean;
  };
  member: MemberProbe;
  /** 이 페이로드로 실제 로그인했다면 세션이 나왔을지 */
  wouldIssueSession: boolean;
  verdict: DiagVerdict;
}

// ---------------------------------------------------------------------------
// 표시 도우미 (화면·복사용)
// ---------------------------------------------------------------------------

const STATUS_MARK: Record<DiagStatus, string> = {
  ok: "✓",
  warn: "!",
  fail: "✕",
  skip: "–",
};

export function statusMark(s: DiagStatus): string {
  return STATUS_MARK[s];
}

const STATUS_RANK: Record<DiagStatus, number> = { fail: 3, warn: 2, ok: 1, skip: 0 };

/** 여러 결과를 하나로 접는다 — 가장 나쁜 것이 이긴다. */
export function worstStatus(list: readonly DiagStatus[]): DiagStatus {
  return list.reduce<DiagStatus>(
    (acc, s) => (STATUS_RANK[s] > STATUS_RANK[acc] ? s : acc),
    "skip",
  );
}

const KIND_LABEL: Record<DiagVerdictKind, string> = {
  config: "환경변수 · 배포 설정",
  build: "빌드에 박힌 값 (재배포 필요)",
  logic: "연동 로직 · 복호화 규격",
  data: "등록 사용자 데이터",
  schema: "DB 스키마 (마이그레이션 미적용)",
  session: "세션 · 쿠키",
  ok: "이상 없음",
};

export function verdictKindLabel(kind: DiagVerdictKind): string {
  return KIND_LABEL[kind];
}

// ---------------------------------------------------------------------------
// 텍스트 변환 — 담당자에게 붙여 넣을 형태 (화면·서버 양쪽에서 쓴다)
// ---------------------------------------------------------------------------

/** 진단 결과를 담당자에게 붙여 넣기 좋은 형태로. */
export function snapshotToText(s: SsoDiagSnapshot): string {
  const lines: string[] = [
    `# SSO 진단 — ${s.at}`,
    `런타임: ${s.runtime.nodeEnv}${s.runtime.vercelEnv ? ` · ${s.runtime.vercelEnv}` : ""}${s.runtime.region ? ` · ${s.runtime.region}` : ""} · ${s.runtime.nextRuntime}`,
    `결론: [${s.verdict.kind}] ${s.verdict.headline}`,
    "",
  ];
  for (const g of s.groups) {
    lines.push(`## ${g.title}`);
    for (const c of g.checks) {
      lines.push(`- [${c.status}] ${c.label}: ${c.value}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** 드라이런 결과 요약 — 규격 문의 메일에 그대로 붙일 수 있게. */
export function dryRunToText(d: SsoDryRun): string {
  const lines: string[] = [
    `# SSO 디코딩 드라이런 — ${d.at}`,
    `모드 ${d.mode} · 페이로드 ${d.payloadKind} · 종류 일치 ${d.kindMatchesMode ? "예" : "아니오"}`,
    `게이트 ${d.trace.gate} · 세션 발급 가능 ${d.wouldIssueSession ? "예" : "아니오"}`,
    "",
    "## 페이로드 모양",
  ];
  if (d.shape.userInfo) lines.push(`- userInfo: ${describeShape(d.shape.userInfo)}`);
  if (d.shape.privateKey) lines.push(`- key: ${describeShape(d.shape.privateKey)}`);
  if (d.shape.encoded) lines.push(`- encoded: ${describeShape(d.shape.encoded)}`);

  lines.push("", "## 전략별 결과");
  for (const a of d.trace.attempts) {
    const keys = a.claimKeys?.length ? ` · 클레임 키: ${a.claimKeys.join(", ")}` : "";
    lines.push(`- ${a.strategy}: ${a.outcome}${a.detail ? ` (${a.detail})` : ""}${keys}`);
  }

  lines.push(
    "",
    "## 결과",
    `- 디코딩 ${d.decoded.ok ? "성공" : "실패"}${d.decoded.error ? ` — ${d.decoded.error}` : ""}`,
    `- EPID ${d.decoded.epid ?? "없음"} · 사번 ${d.decoded.empNo ?? "없음"} · 이름 ${d.decoded.name ?? "없음"}`,
    `- members 매칭: ${d.member.found ? `${d.member.matchedBy} · 활성 ${d.member.isActive}` : "없음"}`,
    ...(d.member.epidColumnMissing
      ? ["- ⚠ members.epid 컬럼 없음 (0012 미적용) — 사번으로만 대조했습니다"]
      : []),
    `- 결론: [${d.verdict.kind}] ${d.verdict.headline}`,
  );
  return lines.join("\n");
}
