import Link from "next/link";
import s from "./ErrorNotice.module.css";

/**
 * Supabase 환경변수가 아직 채워지지 않았을 때 보여 주는 안내.
 *
 * 예외를 던져 500 을 내는 대신 정상 렌더로 처리한다. 초기 셋업 중에 사람이
 * 보게 되는 화면이라, 스택 트레이스보다 다음에 할 일을 알려 주는 편이 낫다.
 */
export default function SetupNotice({ missing }: { missing: string[] }) {
  return (
    <div className={s.wrap}>
      <div className={s.card}>
        <div className={s.badge}>설정 필요</div>

        <h1 className={s.title}>Supabase 설정이 아직 끝나지 않았습니다</h1>
        <p className={s.desc}>
          데이터베이스에 연결할 수 없어 콘텐츠를 불러올 수 없습니다. 아래 두 가지를
          끝내면 정상 동작합니다.
        </p>

        <ol className={s.steps}>
          <li>
            <code>docs/SUPABASE_SETUP.md</code> 를 따라{" "}
            <code>supabase/migrations/</code> 의 SQL 8개를 순서대로 적용
          </li>
          <li>
            <code>.env.local</code> 에 아래 값을 채운 뒤 개발 서버 재시작
          </li>
        </ol>

        <pre className={s.detail}>
          {missing.map((k) => `${k}=`).join("\n")}
        </pre>

        <div className={s.actions}>
          <Link href="/" className={s.retry} style={{ textDecoration: "none" }}>
            다시 시도
          </Link>
          <Link href="/login" className={s.link}>
            로그인 화면으로
          </Link>
        </div>
      </div>
    </div>
  );
}
