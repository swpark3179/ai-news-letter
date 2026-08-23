import type { Block } from "@/types/db";
import { blockFormatClass } from "@/lib/blocks";
import s from "./blocks.module.css";

/**
 * 표 블록 렌더 + 서식 클래스 조회.
 *
 * 지면(ArticleBody)과 작성 화면 미리보기(ArticleComposer)가 함께 쓴다.
 * 표 마크업을 양쪽에 복사해 두면 첫 수정에서 갈라지고, 미리보기가
 * "실제 발행 화면" 이라고 주장하는 것이 거짓이 된다.
 */

/** 블록의 align/size/color 를 공용 스타일시트의 클래스 목록으로. */
export function formatClass(b: Block): string {
  return blockFormatClass(b, s);
}

export default function BlockTable({ block }: { block: Block }) {
  const rows = block.rows ?? [];
  const caption = (block.t ?? "").trim();

  // 머리행조차 없는 표는 렌더할 것이 없다. 캡션만 있으면 캡션만 남긴다.
  if (rows.length === 0) {
    return caption ? <p className={s.caption}>{caption}</p> : null;
  }

  const [head, ...body] = rows;

  return (
    <div className={`${s.tableWrap} ${formatClass(block)}`}>
      <table className={s.table}>
        {caption && <caption className={s.caption}>{caption}</caption>}
        <thead>
          <tr>
            {head.map((c, i) => (
              <th key={i} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        {body.length > 0 && (
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {/*
                  머리행 길이에 맞춰 칸을 채운다. normalizeBlock 이 저장 시점에
                  이미 맞추지만, 그 정규화가 없던 시절에 저장된 행도 어긋나지
                  않게 렌더 시점에서 한 번 더 맞춘다.
                */}
                {head.map((_, c) => (
                  <td key={c}>{row[c] ?? ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        )}
      </table>
    </div>
  );
}
