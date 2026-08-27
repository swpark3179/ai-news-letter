import type { Metadata } from "next";
import { isFailureCode } from "@/lib/auth/sso";
import LoginClient from "./LoginClient";

export const metadata: Metadata = { title: "로그인" };

interface Props {
  searchParams: Promise<{ next?: string; fail?: string; token?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;

  // 오픈 리다이렉트 방지 — 내부 경로만 허용한다.
  const raw = sp.next ?? "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  // 진단 화면은 운영에서 SSO_DEBUG_TOKEN 을 요구한다. /login?token=… 으로 들어왔다면
  // 그대로 물려줘서, 실패 카드의 「로그인 진단」을 한 번 더 입력하지 않고 열 수 있게 한다.
  const diagHref = sp.token
    ? `/login/diag?token=${encodeURIComponent(sp.token)}`
    : "/login/diag";

  return (
    <LoginClient
      next={next}
      forcedFailure={isFailureCode(sp.fail) ? sp.fail : null}
      diagHref={diagHref}
    />
  );
}
