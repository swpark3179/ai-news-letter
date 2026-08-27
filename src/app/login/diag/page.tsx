import type { Metadata } from "next";
import DiagClient from "./DiagClient";

export const metadata: Metadata = { title: "SSO 로그인 진단" };

interface Props {
  searchParams: Promise<{ token?: string }>;
}

/**
 * SSO 로그인 진단 화면.
 *
 * `/login/diag` 는 proxy 의 PUBLIC_PATHS(`/login` 접두사)에 걸려 세션 없이 열린다.
 * **그것이 이 화면의 요점이다** — 진단해야 하는 상황이 곧 로그인이 안 되는
 * 상황이라, 로그인을 요구하면 쓸 수 없다.
 *
 * 대신 실제 자료(환경변수·DB·디코딩 결과)는 전부 API 가 쥐고 있고, 그쪽이
 * 관리자 세션 · SSO_DEBUG_TOKEN · 비운영 빌드 중 하나를 요구한다
 * (lib/auth/sso/diagnostics.ts 의 authorizeDiag). 이 페이지 자체는 토큰을
 * 화면으로 넘겨 주기만 한다 — 서버 컴포넌트에서 검사해도 클라이언트 번들에 이미
 * 박혀 있는 NEXT_PUBLIC_ 값 말고는 아무것도 더 감출 수 없기 때문이다.
 */
export default async function SsoDiagPage({ searchParams }: Props) {
  const sp = await searchParams;
  return <DiagClient token={sp.token?.trim() ?? ""} />;
}
