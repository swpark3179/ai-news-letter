import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import type { Cheerio, CheerioAPI } from "cheerio";
import { htmlToMarkdown, tidyMarkdown } from "../html-markdown";
import { fetchText } from "../http";
import { HADA_BASE } from "./geeknews";

/**
 * news.hada.io 상세(토픽) 페이지 본문 파서.
 *
 * 목록 파서(sources/geeknews.ts)가 제목·요약만 가져오는 데 반해, 이 파일은
 * 상세 페이지를 열어 **본문**을 통째로 가져온다. 앱이 광고 섞인 원문 페이지 대신
 * 저장된 본문을 보여 주기 위해서다.
 *
 * 경계 규칙 — 상세 페이지는 아래 순서다.
 *
 *   제목 → 작성자/메타 → 본문 → "함께 보면 좋은 글" → (관련글 목록) → 댓글
 *
 * "함께 보면 좋은 글" **직전까지**가 저장 대상이다. 경계가 리터럴 문자열이라
 * DOM 절단으로 정확히 끊을 수 있고, 그래서 LLM 을 쓰지 않는다. 원문을 그대로
 * 옮기는 일에 모델을 태우면 비용과 변형 위험만 늘 뿐이다.
 *
 * ⚠️ 셀렉터 실측 필요
 *   BODY_SELECTORS 는 목록 페이지의 작명 계열(topic_row / topictitle /
 *   topicdesc / topicinfo)에서 유추한 **잠정값**이다. 상세 페이지를 실측할 수
 *   있는 환경에서 아래로 확인한 뒤 실제 값으로 교체하고, 그때 이 주석을
 *   "실측한 상세 구조 (YYYY-MM 기준)" 으로 고쳐 쓸 것.
 *
 *     npm run sync:hada-content -- --url=https://news.hada.io/topic?id=33087
 *
 *   또는 GitHub Actions 의 "긱뉴스 상세 구조 진단" 워크플로를 dispatch 한다
 *   (러너는 news.hada.io 에 접근할 수 있다).
 */

/** 본문의 끝을 알리는 문구. 이 노드부터 문서 순서로 뒤를 전부 버린다. */
export const RELATED_MARKER = "함께 보면 좋은 글";

/**
 * 본문 상한. 넘으면 마지막 문단 경계에서 자르고 truncated 로 표시한다.
 *
 * 긱뉴스 본문은 보통 1천자 안팎이라 평시에는 걸리지 않는다. 병적으로 긴
 * 페이지 하나가 DB 를 잠식하는 것을 막는 안전판이다 (20,000자 ≈ 60KB).
 */
export const MAX_BODY_CHARS = 20_000;

/** 이보다 짧으면 "본문을 못 찾았다"로 본다. */
const MIN_BODY_CHARS = 40;

/**
 * 본문 컨테이너 후보. **위에서부터** 시도해 처음으로 실질 텍스트가 잡히는 것을 쓴다.
 *
 * 지나치게 일반적인 후보(#content, main, body …)는 일부러 넣지 않았다. 그런 것이
 * 섞이면 셀렉터가 깨졌을 때도 무언가는 매칭되어 **엉뚱한 내용이 조용히 저장된다.**
 * 아무것도 안 맞으면 parse_failed 로 시끄럽게 실패하는 편이 낫다 —
 * 목록 파서에 EmptyListError 가 있는 것과 같은 이유다.
 */
const BODY_SELECTORS = [
  "#topic_contents",
  ".topic_contents",
  "#topic_content",
  ".topic_content",
  ".topic_body",
  "#topicdesc",
  ".topicdesc",
  ".topic_desc",
  "article",
] as const;

/**
 * 본문에 들어가면 안 되는 것들.
 * 광고(adsbygoogle)와 스크립트, 그리고 관련글이 쓰는 목록 행 템플릿을 걷어낸다.
 */
const NOISE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "ins",
  ".adsbygoogle",
  '[class*="adsbygoogle"]',
  '[id*="google_ads"]',
  '[id*="carbonads"]',
  '[class*="carbonads"]',
  "nav",
  "header",
  "footer",
  "form",
  "div.topic_row",
].join(", ");

export type TopicContentStatus = "ok" | "empty" | "parse_failed";

export interface TopicContent {
  /** "함께 보면 좋은 글" 직전까지의 본문 (마크다운) */
  bodyMd: string;
  chars: number;
  truncated: boolean;
  status: TopicContentStatus;
  /** 어떤 셀렉터로 뽑았는지. 마크업이 바뀌면 여기서 먼저 드러난다. */
  container: string | null;
}

export interface TopicDiagnostics {
  candidates: { selector: string; matched: boolean; textChars: number }[];
  marker: { found: boolean; tag: string; id: string; className: string } | null;
  /** 텍스트가 많은 순 상위 요소들 — 실제 본문 컨테이너를 눈으로 찾기 위한 단서 */
  heaviest: { tag: string; id: string; className: string; textChars: number }[];
}

function describe(el: Element): { tag: string; id: string; className: string } {
  return {
    tag: el.tagName.toLowerCase(),
    id: el.attribs?.id ?? "",
    className: el.attribs?.class ?? "",
  };
}

/**
 * 마커가 시작하는 노드를 찾는다.
 *
 * 텍스트가 마커로 **시작하는** 요소 중 가장 바깥 것을 고른다. 어떤 요소의 텍스트가
 * 마커로 시작한다는 것은 그 안에 마커보다 앞선 본문이 없다는 뜻이므로, 그 요소를
 * 통째로 버려도 본문이 깎이지 않는다. 관련글 섹션 전체가 한 번에 잡힌다.
 */
function findMarkerElement($: CheerioAPI, root: Cheerio<Element>): Cheerio<Element> | null {
  let best: Element | null = null;
  let bestLen = -1;

  root.find("*").each((_, el) => {
    const text = $(el).text().trim();
    if (!text.startsWith(RELATED_MARKER)) return;
    if (text.length > bestLen) {
      best = el;
      bestLen = text.length;
    }
  });

  return best ? $(best as Element) : null;
}

/**
 * 노드 하나를 기준으로 문서 순서상 그 뒤를 전부 버린다.
 *
 * 형제를 지우고 부모로 올라가기를 root 에 닿을 때까지 반복한 뒤, 마지막에 기준
 * 노드 자신을 지운다. 이러면 "이 노드부터 끝까지"가 깔끔하게 잘린다.
 */
function cutFrom(from: Cheerio<Element>, root: Element): void {
  let cur: Cheerio<Element> = from;

  while (cur.length > 0) {
    cur.nextAll().remove();

    const parent = cur.parent();
    const parentNode = parent.get(0);
    if (!parentNode || parentNode === root) break;
    cur = parent as Cheerio<Element>;
  }

  from.remove();
}

/**
 * 마커가 요소 경계에 걸리지 않고 텍스트 한가운데에 있는 경우.
 *   <div>본문… 함께 보면 좋은 글 <a>…</a></div>
 * 그 텍스트 노드를 마커 앞에서 자르고, 거기서부터 뒤를 버린다.
 * 잘라낼 곳을 찾았으면 true.
 */
function cutAtLooseMarker($: CheerioAPI, root: Cheerio<Element>): boolean {
  const rootNode = root.get(0);
  if (!rootNode) return false;

  let target: { parent: Element; index: number; head: string } | null = null;

  // root 자신의 직계 텍스트 노드도 후보다 — 마커가 컨테이너 바로 밑에 놓이는
  // 경우가 흔해서, 자손만 훑으면(find("*")) 그걸 통째로 놓친다.
  outer: for (const el of [rootNode, ...root.find("*").toArray()]) {
    for (const [index, kid] of (el.children ?? []).entries()) {
      if (kid.type !== "text") continue;
      const at = (kid.data ?? "").indexOf(RELATED_MARKER);
      if (at < 0) continue;
      target = { parent: el, index, head: (kid.data ?? "").slice(0, at) };
      break outer;
    }
  }

  if (!target) return false;

  const { parent, index, head } = target;
  const kids = parent.children;

  // 마커가 있던 텍스트 노드는 마커 앞부분만 남기고, 그 뒤 형제는 모두 버린다.
  const textNode = kids[index];
  if (textNode.type === "text") textNode.data = head;
  for (const later of kids.slice(index + 1)) $(later).remove();

  // 그 다음은 부모의 뒤쪽을 문서 순서로 버린다.
  const parentNode = $(parent);
  if (parent !== rootNode) {
    let cur: Cheerio<Element> = parentNode;
    while (cur.length > 0) {
      cur.nextAll().remove();
      const up = cur.parent();
      const upNode = up.get(0);
      if (!upNode || upNode === rootNode) break;
      cur = up as Cheerio<Element>;
    }
  }

  return true;
}

/** 상한을 넘으면 마지막 문단(또는 줄) 경계에서 자른다. */
function capBody(md: string, maxChars: number): { body: string; truncated: boolean } {
  if (md.length <= maxChars) return { body: md, truncated: false };

  const head = md.slice(0, maxChars);
  const cut = Math.max(head.lastIndexOf("\n\n"), head.lastIndexOf("\n"));
  const body = cut > maxChars * 0.5 ? head.slice(0, cut) : head;

  return { body: tidyMarkdown(body), truncated: true };
}

export interface ParseTopicOptions {
  maxChars?: number;
  /** 상대 링크를 절대화할 기준. 기본 https://news.hada.io/ */
  baseUrl?: string;
}

/** 상세 페이지 HTML 한 장에서 본문을 뽑는다. */
export function parseTopicPage(html: string, opts: ParseTopicOptions = {}): TopicContent {
  const { maxChars = MAX_BODY_CHARS, baseUrl = `${HADA_BASE}/` } = opts;

  const $ = cheerio.load(html);
  $(NOISE_SELECTORS).remove();

  for (const selector of BODY_SELECTORS) {
    const container = $(selector).first() as Cheerio<Element>;
    const node = container.get(0);
    if (!node) continue;

    // --- 관련글 이후를 버린다 -------------------------------------------
    // 컨테이너가 이미 본문만 담고 있으면 두 시도 모두 no-op 이 된다.
    const marker = findMarkerElement($, container);
    if (marker) cutFrom(marker, node);
    else cutAtLooseMarker($, container);

    const md = htmlToMarkdown($, container, baseUrl);
    if (md.length < MIN_BODY_CHARS) continue; // 빈 껍데기가 먼저 잡힌 경우

    const { body, truncated } = capBody(md, maxChars);
    return {
      bodyMd: body,
      chars: body.length,
      truncated,
      status: "ok",
      container: selector,
    };
  }

  // 후보 중 하나라도 존재는 했는데 내용이 없었다면 "빈 본문",
  // 아예 아무것도 못 찾았으면 마크업이 바뀐 것으로 본다.
  const anyMatched = BODY_SELECTORS.some((s) => $(s).length > 0);

  return {
    bodyMd: "",
    chars: 0,
    truncated: false,
    status: anyMatched ? "empty" : "parse_failed",
    container: null,
  };
}

/**
 * 셀렉터를 확정하기 위한 진단.
 * 후보별 히트 여부와, 텍스트가 많은 요소들을 돌려준다.
 */
export function diagnoseTopicPage(html: string): TopicDiagnostics {
  const $ = cheerio.load(html);
  $(NOISE_SELECTORS).remove();

  const candidates = BODY_SELECTORS.map((selector) => {
    const el = $(selector).first();
    return {
      selector,
      matched: el.length > 0,
      textChars: el.length > 0 ? el.text().trim().length : 0,
    };
  });

  const markerEl = findMarkerElement($, $("body") as Cheerio<Element>);
  const markerNode = markerEl?.get(0);

  const heaviest: TopicDiagnostics["heaviest"] = [];
  $("body *").each((_, el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "html" || tag === "body") return;
    const textChars = $(el).text().trim().length;
    if (textChars === 0) return;
    heaviest.push({ ...describe(el), textChars });
  });
  heaviest.sort((a, b) => b.textChars - a.textChars);

  return {
    candidates,
    marker: markerNode
      ? { found: true, ...describe(markerNode) }
      : { found: false, tag: "", id: "", className: "" },
    heaviest: heaviest.slice(0, 12),
  };
}

export interface FetchTopicOptions extends ParseTopicOptions {
  /** 이 요청 전에 기다릴 시간 (기본 0 — 호출부가 예절을 관리한다) */
  delayMs?: number;
}

/**
 * 상세 페이지를 받아 본문을 뽑는다.
 *
 * HTTP 는 fetchText 를 그대로 쓴다 — 브라우저 UA(hada.io 는 UA 에 "bot" 이 들면
 * 403), 20초 타임아웃, 403/429/5xx 지수 백오프가 이미 들어 있다.
 */
export async function fetchTopicContent(
  url: string,
  opts: FetchTopicOptions = {},
): Promise<TopicContent> {
  const { delayMs = 0, ...parseOpts } = opts;
  const html = await fetchText(url, { delayMs });
  return parseTopicPage(html, { baseUrl: url, ...parseOpts });
}
