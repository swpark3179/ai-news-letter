import type { Block } from "@/types/db";
import { listItems, splitListLabel } from "@/lib/blocks";
import BlockTable, { formatClass } from "./BlockTable";
import s from "./article.module.css";

/**
 * 블록 배열을 지면 스타일로 렌더 (디자인 473~485행)
 *
 * table · list 분기는 기본 분기(<p>)보다 반드시 앞에 온다. 뒤에 두면 표가 캡션만
 * 들어 있는 문단으로, 목록이 줄바꿈이 사라진 한 문단으로 렌더된다 — if 체인이라
 * 컴파일러가 잡아 주지 않는 자리다.
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
        if (b.type === "list") {
          const items = listItems(b);
          if (items.length === 0) return null;
          // 항목이 하나뿐이면 목록 상자를 칠 이유가 없다.
          if (items.length === 1) {
            return (
              <p key={i} className={`${s.p} ${fmt}`}>
                {items[0]}
              </p>
            );
          }
          // 「한눈에 보기」 라벨은 렌더러가 붙인다. LLM 은 항목만 낸다 —
          // 소제목으로 내게 하면 내용 없는 소제목 금지 규칙과 부딪친다.
          return (
            <aside key={i} className={`${s.glance} ${fmt}`}>
              <p className={s.glanceLabel}>한눈에 보기</p>
              <ul className={s.glanceList}>
                {items.map((item, j) => {
                  const { key, rest } = splitListLabel(item);
                  return (
                    <li key={j}>
                      {key && <strong className={s.glanceKey}>{key}</strong>}
                      {rest}
                    </li>
                  );
                })}
              </ul>
            </aside>
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
