import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import s from "./markdown.module.css";

/**
 * 긱뉴스 · 쇼케이스 본문(hada_contents.body_md) 렌더.
 *
 * 원문 이관이라 남이 쓴 글이 그대로 들어온다. react-markdown 은 기본값으로 HTML 을
 * 글자로 보여 주고(rehype-raw 를 붙이지 않는다) javascript: 같은 주소를 걸러 낸다.
 * 그래서 여기서는 모양만 정한다.
 *
 * 머리글은 한 단계씩 내린다 — 페이지의 h1 은 글 제목 하나여야 한다.
 */

/** react-markdown 이 넘기는 mdast 노드(node)는 DOM 속성이 아니라 걷어 낸다 */
function dom<P extends { node?: unknown }>(props: P): Omit<P, "node"> {
  const copy = { ...props };
  delete copy.node;
  return copy;
}

const components: Components = {
  h1: (p) => <h2 {...dom(p)} />,
  h2: (p) => <h3 {...dom(p)} />,
  h3: (p) => <h4 {...dom(p)} />,
  a: (p) => <a {...dom(p)} target="_blank" rel="noreferrer noopener" />,
  // 표가 본문 폭을 밀어내 페이지에 가로 스크롤이 생기지 않게 표만 따로 흐르게 한다.
  table: (p) => (
    <div className={s.tableWrap}>
      <table {...dom(p)} />
    </div>
  ),
  img: (p) => (
    // 원문의 그림은 크기를 알 수 없어 next/image 를 쓰지 않는다. 남의 서버라 주소만 넘긴다.
    // eslint-disable-next-line @next/next/no-img-element
    <img {...dom(p)} alt={p.alt ?? ""} loading="lazy" referrerPolicy="no-referrer" />
  ),
};

export default function Markdown({ source }: { source: string }) {
  return (
    <div className={s.md}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );
}
