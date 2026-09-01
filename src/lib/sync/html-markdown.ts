import type { AnyNode, Element } from "domhandler";
import type { Cheerio, CheerioAPI } from "cheerio";
import { absoluteUrl } from "./http";
import { isHttpUrl } from "@/lib/url";

/**
 * cheerio DOM → 마크다운 직렬화.
 *
 * turndown 을 새 의존성으로 들이지 않는 이유 — cheerio 는 이미 목록 파서가 쓰고
 * 있고, 긱뉴스 본문에 실제로 나오는 태그 집합이 좁다(문단·목록·링크·코드·인용).
 * 그 좁은 범위를 직접 다루는 편이 의존성 하나와 그 설정을 안고 가는 것보다 낫다.
 *
 * 원문을 "그대로" 옮기는 것이 목적이므로 텍스트는 손대지 않는다. 마크다운 문법은
 * 구조(제목·목록·링크)를 잃지 않기 위한 최소한의 표기일 뿐이다.
 */

/** 자체로 줄바꿈을 만드는 블록 태그. 인라인과 섞였을 때 문단을 나누는 기준. */
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "div", "dl", "dd", "dt",
  "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre",
  "section", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
]);

/**
 * 이스케이프는 최소로만 한다.
 *
 * 마크다운 특수문자를 전부 이스케이프하면 한국어 본문이 역슬래시 범벅이 되어
 * 오히려 읽기 나빠진다. 실제로 오작동을 일으키는 두 가지만 막는다 —
 * 줄머리의 블록 기호(문단이 갑자기 제목/목록/인용으로 바뀌는 것)와
 * 링크 대괄호(가짜 링크가 만들어지는 것).
 */
function escapeText(s: string): string {
  return s
    .replace(/([[\]])/g, "\\$1")
    .replace(/^(\s*)([#>]|[-*+](?=\s)|\d+\.(?=\s))/gm, "$1\\$2");
}

/** 연속 공백을 하나로 접는다 (HTML 의 공백 처리와 같게). */
function collapse(s: string): string {
  return s.replace(/[\t\f\r ]*\n[\t\f\r ]*/g, " ").replace(/[\t\f\r ]{2,}/g, " ");
}

interface Ctx {
  $: CheerioAPI;
  baseUrl: string;
}

function tagOf(node: AnyNode): string {
  return node.type === "tag" ? (node as Element).tagName.toLowerCase() : "";
}

/** href / src 를 절대 URL 로 만들고, http(s) 가 아니면 버린다. */
function safeUrl(raw: string | undefined, baseUrl: string): string | null {
  if (!raw) return null;
  const abs = absoluteUrl(raw, baseUrl);
  return abs && isHttpUrl(abs) ? abs : null;
}

/** 자식 노드들을 이어 붙인다. */
function renderChildren(ctx: Ctx, node: AnyNode, depth: number): string {
  const kids = "children" in node ? (node.children as AnyNode[]) : [];
  return kids.map((k) => renderNode(ctx, k, depth)).join("");
}

/** 인라인 문맥에서만 쓰는 렌더 — 블록이 섞여 있어도 한 줄로 눌러 담는다. */
function renderInline(ctx: Ctx, node: AnyNode, depth: number): string {
  return collapse(renderChildren(ctx, node, depth)).trim();
}

function renderList(ctx: Ctx, el: Element, depth: number): string {
  const ordered = tagOf(el) === "ol";
  const startAttr = Number(el.attribs?.start);
  let n = Number.isFinite(startAttr) && startAttr > 0 ? startAttr : 1;

  const indent = "  ".repeat(depth);
  const lines: string[] = [];

  for (const kid of el.children as AnyNode[]) {
    if (tagOf(kid) !== "li") continue;

    const marker = ordered ? `${n++}. ` : "- ";
    // 중첩 목록은 자식으로 렌더되면서 이미 자기 들여쓰기를 갖는다.
    const body = renderChildren(ctx, kid, depth + 1).trim();
    if (!body) continue;

    // 첫 줄에만 마커를 붙이고 이어지는 줄은 마커 폭만큼 들여쓴다.
    const [first, ...rest] = body.split("\n");
    lines.push(`${indent}${marker}${first}`);
    for (const line of rest) {
      lines.push(line.trim() ? `${indent}${" ".repeat(marker.length)}${line}` : "");
    }
  }

  return lines.length > 0 ? `\n${lines.join("\n")}\n\n` : "";
}

/**
 * 표는 GFM 파이프 표로. 셀 안의 개행과 파이프만 무해하게 바꾼다.
 * 헤더 행이 없으면 첫 행을 헤더로 쓴다 (GFM 은 헤더 없는 표를 표현하지 못한다).
 */
function renderTable(ctx: Ctx, el: Element, depth: number): string {
  const $ = ctx.$;
  const rows: string[][] = [];

  $(el)
    .find("tr")
    .each((_, tr) => {
      const cells: string[] = [];
      $(tr)
        .children("th, td")
        .each((__, cell) => {
          cells.push(renderInline(ctx, cell, depth).replace(/\|/g, "\\|"));
        });
      if (cells.length > 0) rows.push(cells);
    });

  if (rows.length === 0) return "";

  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];

  const [head, ...body] = rows;
  const out = [
    `| ${pad(head).join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...body.map((r) => `| ${pad(r).join(" | ")} |`),
  ];

  return `\n${out.join("\n")}\n\n`;
}

function renderNode(ctx: Ctx, node: AnyNode, depth: number): string {
  if (node.type === "text") {
    return escapeText(collapse(node.data ?? ""));
  }
  if (node.type !== "tag") return ""; // 주석·지시자 등은 버린다

  const el = node as Element;
  const tag = tagOf(el);

  switch (tag) {
    case "script":
    case "style":
    case "noscript":
    case "template":
      return "";

    case "br":
      return "\n";

    case "hr":
      return "\n\n---\n\n";

    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const text = renderInline(ctx, el, depth);
      return text ? `\n\n${"#".repeat(Number(tag[1]))} ${text}\n\n` : "";
    }

    case "p": {
      const text = renderChildren(ctx, el, depth).trim();
      return text ? `\n\n${text}\n\n` : "";
    }

    case "ul":
    case "ol":
      return renderList(ctx, el, depth);

    case "li":
      // renderList 가 처리한다. 목록 밖의 고아 li 만 여기로 온다.
      return `\n- ${renderInline(ctx, el, depth)}\n`;

    case "pre": {
      // <pre><code class="language-ts"> 형태가 흔하다.
      const code = ctx.$(el).find("code").first();
      const lang = (code.attr("class") ?? "")
        .split(/\s+/)
        .find((c) => c.startsWith("language-"))
        ?.slice("language-".length);
      const raw = (code.length > 0 ? code.text() : ctx.$(el).text()).replace(/\n+$/, "");
      return raw ? `\n\n\`\`\`${lang ?? ""}\n${raw}\n\`\`\`\n\n` : "";
    }

    case "code": {
      // pre 안의 code 는 위에서 이미 처리됐다.
      const raw = ctx.$(el).text();
      if (!raw.trim()) return "";
      // 내용에 백틱이 있으면 울타리를 늘려 깨지지 않게 한다.
      const longest = (raw.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
      const fence = "`".repeat(longest + 1);
      const padding = raw.startsWith("`") || raw.endsWith("`") ? " " : "";
      return `${fence}${padding}${raw}${padding}${fence}`;
    }

    case "strong":
    case "b": {
      const text = renderChildren(ctx, el, depth).trim();
      return text ? `**${text}**` : "";
    }

    case "em":
    case "i": {
      const text = renderChildren(ctx, el, depth).trim();
      return text ? `*${text}*` : "";
    }

    case "del":
    case "s": {
      const text = renderChildren(ctx, el, depth).trim();
      return text ? `~~${text}~~` : "";
    }

    case "a": {
      const text = renderChildren(ctx, el, depth).trim();
      if (!text) return "";
      const href = safeUrl(el.attribs?.href, ctx.baseUrl);
      return href ? `[${text}](${href})` : text;
    }

    case "img": {
      const src = safeUrl(el.attribs?.src, ctx.baseUrl);
      if (!src) return "";
      const alt = escapeText(el.attribs?.alt ?? "");
      return `![${alt}](${src})`;
    }

    case "blockquote": {
      const inner = renderChildren(ctx, el, depth).trim();
      if (!inner) return "";
      const quoted = inner.split("\n").map((l) => (l.trim() ? `> ${l}` : ">")).join("\n");
      return `\n\n${quoted}\n\n`;
    }

    case "table":
      return renderTable(ctx, el, depth);

    // 표 내부는 renderTable 이 직접 순회하므로 여기로 오면 무시한다.
    case "thead":
    case "tbody":
    case "tfoot":
    case "tr":
    case "th":
    case "td":
      return "";

    default: {
      const inner = renderChildren(ctx, el, depth);
      // 블록 태그는 앞뒤를 띄워 문단이 붙지 않게 한다.
      return BLOCK_TAGS.has(tag) && inner.trim() ? `\n\n${inner.trim()}\n\n` : inner;
    }
  }
}

/** 빈 줄 3개 이상을 2개로 접고, 줄 끝 공백을 턴다. */
export function tidyMarkdown(md: string): string {
  return md
    .replace(/[ \t]+$/gm, "")
    // 블록 사이에 낀 텍스트 노드가 줄머리에 공백 하나를 남긴다 (HTML 에서 개행은
    // 곧 공백이므로). 목록 들여쓰기(2칸 이상)는 건드리지 않도록 한 칸만 턴다.
    .replace(/^ (?=\S)/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 요소 하나를 마크다운으로 옮긴다.
 *
 * baseUrl 은 상대 링크를 절대화하는 기준이다. http(s) 가 아닌 링크(javascript:,
 * data: 등)는 주소를 버리고 글자만 남긴다 — 저장형 XSS 를 DB 단에서 끊는다.
 */
export function htmlToMarkdown(
  $: CheerioAPI,
  el: Cheerio<Element>,
  baseUrl: string,
): string {
  const node = el.get(0);
  if (!node) return "";
  return tidyMarkdown(renderChildren({ $, baseUrl }, node, 0));
}
