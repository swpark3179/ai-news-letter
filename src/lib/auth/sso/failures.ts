import type { SsoFailure, SsoFailureCode } from "./types";

/** 디자인 AUTH_FAILS (원본 1684~1715행) 를 그대로 옮긴 것. */
export const AUTH_FAILURES: readonly SsoFailure[] = [
  {
    code: "SSO_TRAY_NOT_RUNNING",
    title: "SSO 인증 모듈이 실행 중이 아닙니다",
    desc: "PC 트레이의 사내 인증 모듈이 응답하지 않아 자동 로그인을 완료하지 못했습니다.",
    checks: [
      {
        t: "트레이에서 인증 모듈 실행",
        d: "작업 표시줄 오른쪽 트레이에서 사내 인증 아이콘을 확인하고 실행해 주세요.",
      },
      {
        t: "실행 후 다시 시도",
        d: "모듈이 켜진 뒤 아래 다시 시도를 누르면 자동 로그인을 재요청합니다.",
      },
      {
        t: "급한 경우 사번 로그인",
        d: "사번과 비밀번호로 먼저 열람하고, 모듈은 나중에 복구해도 됩니다.",
      },
    ],
  },
  {
    code: "SSO_TRAY_NOT_INSTALLED",
    title: "SSO Tray가 설치되어 있지 않습니다",
    desc: "이 기기에서 사내 인증 모듈을 찾을 수 없습니다. 설치 후에만 자동 로그인을 사용할 수 있습니다.",
    checks: [
      {
        t: "사내 포털에서 설치 파일 내려받기",
        d: "포털 > 업무 도구 > 사내 인증 모듈에서 설치할 수 있습니다.",
      },
      {
        t: "설치 후 기기 재로그인",
        d: "설치가 끝나면 최초 1회 사번 로그인으로 기기를 등록해야 합니다.",
      },
      {
        t: "개인 기기에서는 사번 로그인 사용",
        d: "사외 기기에는 인증 모듈을 설치할 수 없습니다.",
      },
    ],
  },
  {
    code: "SSO_TIMEOUT_30S",
    title: "네트워크 지연으로 로그인이 시간 초과되었습니다",
    desc: "30초 안에 인증 서버 응답을 받지 못했습니다. 사내망 연결 상태를 확인해 주세요.",
    checks: [
      {
        t: "VPN · 사내망 연결 확인",
        d: "사외에서는 VPN이 연결된 상태에서만 SSO 인증이 통과됩니다.",
      },
      {
        t: "잠시 후 다시 시도",
        d: "일시적인 인증 서버 지연일 수 있습니다.",
      },
      {
        t: "반복되면 담당자 문의",
        d: "AI Unit 박세원 · 인증 로그와 함께 전달해 주세요.",
      },
    ],
  },
] as const;

export function failureOf(code: SsoFailureCode): SsoFailure {
  return AUTH_FAILURES.find((f) => f.code === code) ?? AUTH_FAILURES[0];
}

export function isFailureCode(v: string | null | undefined): v is SsoFailureCode {
  return !!v && AUTH_FAILURES.some((f) => f.code === v);
}
