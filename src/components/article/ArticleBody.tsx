import type { Block } from "@/types/db";
import s from "./article.module.css";

/** 블록 배열을 지면 스타일로 렌더 (디자인 473~485행) */
export default function ArticleBody({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === "head") {
          return (
            <h3 key={i} className={s.h3}>
              {b.t}
            </h3>
          );
        }
        if (b.type === "quote") {
          return (
            <blockquote key={i} className={s.quote}>
              {b.t}
            </blockquote>
          );
        }
        return (
          <p key={i} className={s.p}>
            {b.t}
          </p>
        );
      })}
    </>
  );
}
