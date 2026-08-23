import type { Block, BlockColor, BlockSize } from "@/types/db";

/**
 * 본문 블록을 다루는 공용 규칙.
 *
 * "비어 있으면 버린다" 판정이 작성 화면·저장 API·동기화 세 곳에 흩어져 있었고,
 * 셋 다 `b.t.trim()` 만 봤다. 표 블록은 캡션(t)이 비어도 셀에 내용이 있을 수
 * 있어서 그 판정으로는 저장 직전에 조용히 사라진다. 그래서 한곳에 모았다.
 *
 * 방어적으로 쓴다: LLM 응답은 required 를 어기고 t 를 빼먹을 수 있어서
 * (sync/trend.ts 가 `b.t?.trim()` 을 쓰고 있던 이유) 여기서 t 를 옵셔널로 다룬다.
 */

/** 표 한 칸의 최대 길이. 서버 zod 스키마와 같은 값을 쓴다. */
export const TABLE_MAX_COLS = 8;
export const TABLE_MAX_ROWS = 30;
export const TABLE_MAX_CELL_CHARS = 500;

function cells(b: Block): string[] {
  return (b.rows ?? []).flat();
}

/** 저장·표시할 만한 내용이 있는가. 표는 셀 하나라도 채워져 있으면 true. */
export function blockHasContent(b: Block): boolean {
  if (b.type === "table") {
    return cells(b).some((c) => (c ?? "").trim().length > 0);
  }
  return (b.t ?? "").trim().length > 0;
}

/** 글자수·읽는 시간 계산용 평문. 표는 캡션과 모든 셀을 합친다. */
export function blockPlainText(b: Block): string {
  if (b.type === "table") {
    return [b.t ?? "", ...cells(b)].filter((s) => (s ?? "").trim()).join(" ");
  }
  return b.t ?? "";
}

/**
 * 저장 직전 정규화. `articles.body` 로 가는 유일한 통로에서 한 번만 돌린다.
 *
 * body 열은 제약 없는 jsonb 이고 supabase 클라이언트도 untyped 라, 여기서
 * 걸러 내지 않으면 어떤 모양이든 그대로 들어간다. 두 가지를 정리한다.
 *   - table 이 아닌 블록에 붙은 rows 를 떼어 낸다.
 *   - 들쭉날쭉한 행을 머리행 길이에 맞춘다. 안 맞추면 렌더할 때 td 개수가
 *     행마다 달라져 표가 어긋난다.
 */
export function normalizeBlock(b: Block): Block {
  if (b.type !== "table") {
    if (b.rows === undefined) return b;
    const rest = { ...b };
    delete rest.rows;
    return rest;
  }

  const raw = (b.rows ?? []).slice(0, TABLE_MAX_ROWS);
  const width = Math.min(
    Math.max(raw[0]?.length ?? 0, 1),
    TABLE_MAX_COLS,
  );
  const rows = raw.map((r) =>
    Array.from({ length: width }, (_, i) =>
      (r[i] ?? "").slice(0, TABLE_MAX_CELL_CHARS),
    ),
  );

  return { ...b, rows };
}

// ---------------------------------------------------------------------------
// 서식 → CSS 모듈 클래스
// ---------------------------------------------------------------------------

/**
 * 클래스 조회를 맵으로 하는 이유: `s[b.align]` 로 쓰면 align 이 없는 기존 행에서
 * `class="p undefined"` 가 나온다. 기본값을 가진 맵으로만 조회한다.
 *
 * 실제 클래스 이름은 blocks.module.css 가 갖고 있고, 이 파일은 키만 정한다.
 */
export const ALIGN_KEY = { left: "alignLeft", center: "alignCenter", right: "alignRight" } as const;
export const SIZE_KEY: Record<BlockSize, string> = { sm: "sizeSm", md: "sizeMd", lg: "sizeLg" };
export const COLOR_KEY: Record<BlockColor, string> = {
  default: "colorDefault",
  purple: "colorPurple",
  blue: "colorBlue",
  green: "colorGreen",
  red: "colorRed",
  yellow: "colorYellow",
  gray: "colorGray",
};

/**
 * 블록의 서식 속성을 CSS 모듈 클래스 목록으로 바꾼다.
 * 지면과 미리보기가 같은 스타일시트를 쓰므로 두 곳이 이 함수를 공유한다.
 */
export function blockFormatClass(
  b: Block,
  s: Record<string, string>,
): string {
  const out: string[] = [];
  if (b.align && b.align !== "left") out.push(s[ALIGN_KEY[b.align]]);
  if (b.size && b.size !== "md") out.push(s[SIZE_KEY[b.size]]);
  if (b.color && b.color !== "default") out.push(s[COLOR_KEY[b.color]]);
  return out.filter(Boolean).join(" ");
}
