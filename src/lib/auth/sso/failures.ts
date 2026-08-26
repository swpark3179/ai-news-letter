import type { SsoFailure, SsoFailureCode } from "./types";

/**
 * 로그인 실패 안내 카드.
 *
 * 앞 3종은 디자인 AUTH_FAILS(원본 1684~1715행)를 그대로 옮긴 것이고, 뒤 2종은
 * 실 연동에서 새로 생긴 경우다. 서버가 응답 본문의 `code` 로 돌려주면 화면이
 * 그대로 골라 쓴다 (LoginClient 의 isFailureCode 분기).
 */
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
        t: "로컬 인증서 신뢰 확인",
        d: "브라우저는 「인증서를 못 믿음」과 「모듈 미실행」을 구분해 주지 않습니다. 트레이 주소를 새 탭에서 한 번 열어 인증서를 수락해 보세요.",
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
  {
    code: "SSO_NOT_REGISTERED",
    title: "등록된 사용자가 아닙니다",
    desc: "사내 인증은 통과했지만, 이 뉴스레터에 등록된 사용자 목록에서 찾을 수 없습니다.",
    checks: [
      {
        t: "구독 신청 여부 확인",
        d: "AI Unit 뉴스레터는 등록된 사용자만 열람할 수 있습니다.",
      },
      {
        t: "담당자에게 등록 요청",
        d: "AI Unit 박세원 · 사번과 이름을 함께 알려 주세요.",
      },
      {
        t: "최근 부서 이동 · 계정 변경",
        d: "인사 정보가 바뀐 직후에는 반영에 하루 정도 걸릴 수 있습니다.",
      },
    ],
  },
  {
    code: "SSO_CONFIG_MISSING",
    title: "SSO 연동 설정이 비어 있습니다",
    desc: "이 배포에 트레이 주소 또는 애플리케이션 코드가 지정되지 않았습니다. 사용자가 아니라 배포 설정 문제입니다.",
    checks: [
      {
        t: "NEXT_PUBLIC_SSO_TRAY_WS_URL",
        d: "트레이 모듈의 로컬 주소입니다. 레거시 참고값 wss://localhost:29283.",
      },
      {
        t: "NEXT_PUBLIC_SSO_TRAY_APP_CODE",
        d: "트레이가 애플리케이션을 구분하는 코드입니다. 이 서비스용으로 발급받아 넣어야 합니다.",
      },
      {
        t: "재배포 필요",
        d: "NEXT_PUBLIC_ 값은 빌드에 박히므로 환경변수만 바꾸고는 반영되지 않습니다.",
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
