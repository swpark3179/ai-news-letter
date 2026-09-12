import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeekNewsRow } from "@/types/db";
import type { SyncRun } from "./run-log";

/**
 * 긱뉴스(`/`) ↔ 쇼케이스(`/show`) 중복 정리.
 *
 * ── 왜 겹치나
 * `/show` 에 올라온 글은 메인 목록에도 함께 뜬다. 두 목록이 같은 `div.topic_row`
 * 템플릿을 쓰므로 요약부 링크(= 두 테이블의 PK)까지 같은 문자열이고, 그래서 같은
 * 글이 `geek_news` 와 `showcase_items` 에 한 행씩 따로 쌓인다. 각 테이블 안에서는
 * PK 가 막아 주지만 테이블을 가로지르는 중복은 아무도 막지 않는다.
 *
 * ── 어느 쪽을 남기나 — **쇼케이스**
 * "누가 무엇을 만들었나"가 "읽을 거리 하나"보다 좁고 확실한 정보다. 뉴스 목록에서
 * 그 글은 링크 하나지만 쇼케이스에는 만든 사람과 만든 것이라는 자리가 있다.
 * 방향을 한쪽으로 못박아야 **어느 수집기가 먼저 돌든 결과가 같다** — 지금 일정은
 * 긱뉴스 07:00, 쇼케이스 07:20 이라 그날치는 긱뉴스에 먼저 들어간다.
 *
 *   긱뉴스 수집 중  쇼케이스에 있는 URL 을 만나면 → 적재하지 않고, 이미 들어가
 *                   있던 긱뉴스 행이 있으면 지운다.
 *   쇼케이스 수집 중 긱뉴스에 있는 URL 을 만나면 → 수집 이력을 이어받아 쇼케이스로
 *                   옮겨 담고, 긱뉴스에서 지운다.
 *
 * ── 본문(`hada_contents`)은 지우지 않는다
 * PK 가 같은 토픽 URL 이고 상세 페이지도 하나뿐이다. 소유한 목록만 바뀌었을 뿐
 * 본문은 그대로 쓸 수 있으므로 `source` 라벨만 `showcase` 로 고쳐 단다. 지우면
 * 다음 실행에서 같은 페이지를 쓸데없이 다시 받는다.
 *
 * ── 보관함(`scraps`)
 * `scraps` 는 `(target_type, target_key)` 로만 참조하고 FK 가 없다. 원본이 사라진
 * 항목은 이미 null 로 떨어지게 되어 있어(lib/data/scraps.ts) 목록이 깨지지 않는다.
 * 다만 긱뉴스로 보관해 둔 항목은 쇼케이스로 옮겨진 뒤 보관함에서 빈칸이 된다 —
 * 쇼케이스에는 아직 보관 대상 종류가 없기 때문이다.
 */

/** PostgREST 의 `.in()` 에 한 번에 넣을 최대 개수 (hada-content.ts 와 같은 값). */
const IN_CHUNK = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function selectByUrl<T>(
  db: SupabaseClient,
  table: string,
  columns: string,
  urls: string[],
  what: string,
): Promise<T[]> {
  const out: T[] = [];

  for (const part of chunk(urls, IN_CHUNK)) {
    const { data, error } = await db
      .from(table)
      .select(columns)
      .in("url", part)
      .returns<T[]>();

    if (error) throw new Error(`${what} 조회 실패: ${error.message}`);
    out.push(...(data ?? []));
  }

  return out;
}

/**
 * 긱뉴스에서 행을 걷어 내고, 딸린 본문은 쇼케이스 소유로 고쳐 단다.
 *
 * 본문 라벨 갱신이 실패해도 예외로 올리지 않는다. 중복 제거는 이미 끝났고,
 * 라벨은 다음 실행의 백필 후보 선정에만 쓰이는 부가 정보다.
 */
async function removeFromGeekNews(
  db: SupabaseClient,
  urls: string[],
  run: SyncRun,
): Promise<number> {
  let deleted = 0;

  for (const part of chunk(urls, IN_CHUNK)) {
    const { data, error } = await db
      .from("geek_news")
      .delete()
      .in("url", part)
      .select("url")
      .returns<{ url: string }[]>();

    if (error) throw new Error(`긱뉴스 중복 행 삭제 실패: ${error.message}`);
    deleted += data?.length ?? 0;
  }

  const now = new Date().toISOString();
  for (const part of chunk(urls, IN_CHUNK)) {
    const { error } = await db
      .from("hada_contents")
      .update({ source: "showcase", updated_at: now })
      .in("url", part)
      .eq("source", "geeknews");

    if (error) run.log(`본문 소유 표시 갱신 실패: ${error.message}`, "warn");
  }

  return deleted;
}

export interface DedupOptions {
  run: SyncRun;
  dryRun?: boolean;
}

/**
 * 긱뉴스 수집 쪽 정리.
 *
 * 이번에 긁어 온 URL 중 쇼케이스가 이미 가진 것을 찾아, 긱뉴스에 남아 있던 행을
 * 지운다. 돌려주는 집합은 호출부가 **적재 대상에서 빼는** 데 쓴다.
 *
 * 기존 항목 조회보다 **먼저** 부른다. 그래야 여기서 지운 행이 "이미 있는 항목"으로
 * 다시 세어지지 않는다.
 */
export async function dropShowcaseOverlap(
  db: SupabaseClient,
  urls: string[],
  opts: DedupOptions,
): Promise<Set<string>> {
  const { run, dryRun = false } = opts;
  if (urls.length === 0) return new Set();

  const owned = await selectByUrl<{ url: string }>(
    db,
    "showcase_items",
    "url",
    urls,
    "쇼케이스 중복",
  );
  const overlap = new Set(owned.map((r) => r.url));
  if (overlap.size === 0) return overlap;

  run.log(`쇼케이스에 이미 있는 ${overlap.size}건은 긱뉴스로 담지 않습니다.`);

  // 지난 실행에서 이미 긱뉴스로 들어간 행이 있으면 여기서 걷어 낸다.
  const stale = await selectByUrl<{ url: string }>(
    db,
    "geek_news",
    "url",
    [...overlap],
    "긱뉴스 중복",
  );
  if (stale.length === 0) return overlap;

  if (dryRun) {
    run.log(
      `[dry-run] 긱뉴스에 쌓여 있는 중복 ${stale.length}건을 지우지 않고 넘어갑니다.`,
      "warn",
    );
    return overlap;
  }

  const deleted = await removeFromGeekNews(
    db,
    stale.map((r) => r.url),
    run,
  );
  run.log(`긱뉴스에 중복으로 쌓여 있던 ${deleted}건을 삭제했습니다.`);

  return overlap;
}

/** 이관 대상 — 쇼케이스가 넘겨받을 긱뉴스 행에서 이어받는 값들. */
export type HandoverRow = Pick<
  GeekNewsRow,
  "url" | "is_hidden" | "collected_at" | "collected_date"
>;

const HANDOVER_COLS = "url, is_hidden, collected_at, collected_date";

/**
 * 쇼케이스 수집 1단계 — 같은 URL 을 들고 있는 긱뉴스 행을 읽어 둔다.
 *
 * 적재 **전에** 읽는 이유는 수집 이력(`collected_at` / `collected_date`)과 숨김
 * 여부를 이어받기 위해서다. 오늘 처음 본 글로 다시 적으면 지난 날짜의 "오늘 몇
 * 건" 집계가 흔들리고, 운영자가 감춰 둔 글이 도로 나타난다.
 */
export async function findGeekNewsOverlap(
  db: SupabaseClient,
  urls: string[],
): Promise<Map<string, HandoverRow>> {
  if (urls.length === 0) return new Map();

  const rows = await selectByUrl<HandoverRow>(
    db,
    "geek_news",
    HANDOVER_COLS,
    urls,
    "긱뉴스 중복",
  );

  return new Map(rows.map((r) => [r.url, r]));
}

/**
 * 쇼케이스 수집 2단계 — 쇼케이스 적재가 끝난 뒤 긱뉴스 행을 걷어 낸다.
 *
 * 반드시 적재 **뒤에** 부른다. 먼저 지우면 적재가 실패했을 때 그 항목이 어느
 * 테이블에도 남지 않는다.
 */
export async function finishHandover(
  db: SupabaseClient,
  urls: string[],
  opts: DedupOptions,
): Promise<number> {
  const { run, dryRun = false } = opts;
  if (urls.length === 0) return 0;

  if (dryRun) {
    run.log(
      `[dry-run] 긱뉴스에 있는 ${urls.length}건을 이관하지 않고 넘어갑니다.`,
      "warn",
    );
    return 0;
  }

  const deleted = await removeFromGeekNews(db, urls, run);
  run.log(`긱뉴스에 있던 ${deleted}건을 쇼케이스로 이관했습니다.`);

  return deleted;
}
