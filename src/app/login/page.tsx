import type { Metadata } from "next";
import { isFailureCode } from "@/lib/auth/sso";
import LoginClient from "./LoginClient";

export const metadata: Metadata = { title: "로그인" };

interface Props {
  searchParams: Promise<{ next?: string; fail?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;

  // 오픈 리다이렉트 방지 — 내부 경로만 허용한다.
  const raw = sp.next ?? "/";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";

  return (
    <LoginClient
      next={next}
      forcedFailure={isFailureCode(sp.fail) ? sp.fail : null}
    />
  );
}
