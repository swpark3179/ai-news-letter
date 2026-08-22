import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * supabase/migrations/*.sql 을 하나로 이어 붙여 ALL_MIGRATIONS.sql 을 만든다.
 * 대시보드 SQL Editor 에 한 번에 붙여넣기 위한 편의 파일이다.
 *
 *   node scripts/bundle-sql.mjs      (npm run sql:bundle)
 */

const DIR = "supabase/migrations";
const OUT = "supabase/ALL_MIGRATIONS.sql";

const files = readdirSync(DIR)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

const bar = "-- " + "=".repeat(75);

const header = `-- =============================================================================
-- AI 뉴스레터 — 전체 스키마 (통합본)
--
-- supabase/migrations/ 의 SQL 을 번호 순서대로 이어 붙인 것입니다.
-- Supabase 대시보드 → SQL Editor 에 이 파일 전체를 붙여넣고 한 번에 Run 하세요.
--
-- 전부 \`if not exists\` / \`on conflict do nothing\` 이라 여러 번 실행해도 안전합니다.
-- 이 파일은 생성물입니다. 스키마를 고칠 때는 migrations/ 의 개별 파일을 고치고
-- npm run sql:bundle 로 다시 만드세요.
-- =============================================================================
`;

const body = files
  .map((f) => {
    const sql = readFileSync(join(DIR, f), "utf8").trimEnd();
    return [bar, `-- ${basename(f)}`, bar, "", sql, ""].join("\n");
  })
  .join("\n");

writeFileSync(OUT, `${header}\n${body}\n`, "utf8");

console.log(`${OUT} 생성 — ${files.length}개 파일 병합`);
for (const f of files) console.log(`  · ${f}`);
