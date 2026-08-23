import type { Block } from "@/types/db";
import BlockTable, { formatClass } from "./BlockTable";
import s from "./article.module.css";

/**
 * 블록 배열을 지면 스타일로 렌더 (디자인 473~485행)
 *
 * table 분기는 기본 분기(<p>)보다 반드시 앞에 온다. 뒤에 두면 표가 캡션만 들어
 * 있는 문단으로 렌더되고 rows 가 조용히 사라진다 — if 체인이라 컴파일러가
 * 잡아 주지 않는 자리다.
 */
export default function ArticleBody({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        const fmt = formatClass(b);

        if (b.type === "table") {
          return <BlockTable key={i} block={b} />;
        }
        if (b.type === "head") {
          return (
            <h3 key={i} className={`${s.h3} ${fmt}`}>
              {b.t}
            </h3>
          );
        }
        if (b.type === "quote") {
          return (
            <blockquote key={i} className={`${s.quote} ${fmt}`}>
              {b.t}
            </blockquote>
          );
        }
        return (
          <p key={i} className={`${s.p} ${fmt}`}>
            {b.t}
          </p>
        );
      })}
    </>
  );
}
