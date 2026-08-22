"use client";

import Link from "next/link";
import s from "./ErrorNotice.module.css";

interface Props {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * 세그먼트 에러 바운더리 공용 UI.
 *
 * 초기 셋업 단계에서 가장 흔한 실패는 Supabase 환경변수 누락이다. 그 경우에는
 * 스택 대신 무엇을 해야 하는지 알려 준다.
 */
export default function ErrorNotice({ error, reset }: Props) {
  const msg = error.message ?? "";
  const isEnv = /환경변수|SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY/.test(msg);
  const isNetwork = /fetch failed|ENOTFOUND|ECONNREFUSED|Connect Timeout/i.test(msg);

  return (
    <div className={s.wrap}>
      <div className={s.card}>
        <div className={s.badge}>
          {isEnv ? "설정 필요" : isNetwork ? "연결 실패" : "오류"}
        </div>

        {isEnv ? (
          <>
            <h1 className={s.title}>Supabase 설정이 아직 끝나지 않았습니다</h1>
            <p className={s.desc}>
              데이터베이스에 연결할 수 없어 화면을 그릴 수 없습니다. 아래 두 가지를
              끝내면 정상 동작합니다.
            </p>
            <ol className={s.steps}>
              <li>
                <code>docs/SUPABASE_SETUP.md</code> 를 따라{" "}
                <code>supabase/migrations/</code> 의 SQL 8개를 순서대로 적용
              </li>
              <li>
                <code>.env.local</code> 에 <code>SUPABASE_URL</code> 과{" "}
                <code>SUPABASE_SERVICE_ROLE_KEY</code> 를 채운 뒤 개발 서버 재시작
              </li>
            </ol>
          </>
        ) : isNetwork ? (
          <>
            <h1 className={s.title}>외부 연결에 실패했습니다</h1>
            <p className={s.desc}>
              Supabase 또는 외부 API 에 닿지 못했습니다. 사내 프록시 환경이라면{" "}
              <code>HTTPS_PROXY</code> 설정을 확인하세요.
            </p>
          </>
        ) : (
          <>
            <h1 className={s.title}>화면을 불러오지 못했습니다</h1>
            <p className={s.desc}>잠시 후 다시 시도해 주세요.</p>
          </>
        )}

        <pre className={s.detail}>{msg || "알 수 없는 오류"}</pre>

        <div className={s.actions}>
          <button type="button" className={s.retry} onClick={reset}>
            다시 시도
          </button>
          <Link href="/login" className={s.link}>
            로그인 화면으로
          </Link>
        </div>
      </div>
    </div>
  );
}
