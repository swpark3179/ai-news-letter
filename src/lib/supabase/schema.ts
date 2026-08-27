/**
 * 스키마 드리프트(마이그레이션 미적용) 감지.
 *
 * 이 저장소는 Supabase CLI 를 쓰지 않고 SQL 을 손으로 붙여넣어 적용한다
 * (docs/SUPABASE_MANUAL_SETUP.md). 그래서 「코드는 새 컬럼을 쓰는데 그 배포의
 * DB 에는 아직 없다」는 상태가 실제로 생긴다. 그때 PostgREST 가 돌려주는 오류를
 * 그대로 위로 던지면 화면에는 `column members.epid does not exist` 라는 원문이
 * 500 으로 나가고, 정작 할 일(마이그레이션 적용)은 아무 데도 적히지 않는다.
 *
 * 그래서 「그 컬럼이 없다」만 따로 알아보고, 호출부가 안내 문구를 고르거나
 * 컬럼 없이도 되는 일을 계속하게 한다.
 */

/** Postgres — 질의 필터·select 에 없는 컬럼을 썼다 (undefined_column). */
const UNDEFINED_COLUMN = "42703";
/** PostgREST — insert·update 본문에 스키마 캐시에 없는 컬럼이 들어 있다. */
const SCHEMA_CACHE_MISS = "PGRST204";

interface DbErrorish {
  code?: string | null;
  message?: string | null;
}

/**
 * 이 오류가 「[column] 이라는 컬럼이 없다」인지.
 *
 * 코드만 보지 않고 메시지에 컬럼 이름이 있는지도 확인한다 — 같은 42703 이라도
 * 다른 컬럼 이야기일 수 있고, 그때는 조용히 넘기면 안 되는 진짜 버그다.
 */
export function isMissingColumnError(
  error: DbErrorish | null | undefined,
  column: string,
): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code !== UNDEFINED_COLUMN && code !== SCHEMA_CACHE_MISS) return false;
  const message = error.message ?? "";
  // 42703 은 `column members.epid does not exist`,
  // PGRST204 는 `Could not find the 'epid' column of 'members' …` 형태다.
  return new RegExp(`(^|[^\\w])${escapeForRegExp(column)}($|[^\\w])`).test(message);
}

function escapeForRegExp(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * members.epid 가 없을 때 쓰는 안내 문구.
 *
 * 로그인 라우트·진단 화면·서버 로그가 모두 이 한 문장을 쓴다. 사용자가 읽는
 * 문구와 담당자가 보는 문구가 갈리면, 화면을 보고 온 사람과 로그를 보고 온
 * 사람이 서로 다른 것을 고치게 된다.
 */
export const MEMBERS_EPID_MISSING =
  "이 배포의 데이터베이스에 members.epid 컬럼이 없습니다 — " +
  "supabase/migrations/0012_member_epid.sql 이 적용되지 않았습니다. " +
  "Supabase 대시보드 → SQL Editor 에 그 파일을 붙여넣고 실행한 뒤 다시 시도해 주세요.";
