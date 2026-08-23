import { shortDot } from "@/lib/format";
import type { TrendItemRow } from "@/types/db";

/**
 * 목록 행의 표기 규칙.
 *
 * 모든 브리핑 행은 [식별 줄] + [한 줄 설명] + [메타] 세 조각이고, 식별 줄에는
 * 그 항목을 가장 알아보기 쉬운 문자열이 온다. GitHub 은 저장소 이름이 AI 헤드라인보다
 * 눈에 빨리 들어오므로 저장소 이름이 제목 자리를 가져가고 AI 제목이 설명으로 내려간다.
 * 짧은 식별자가 없는 HN·arXiv 는 AI 제목이 그대로 식별 줄이다.
 *
 * 메인 3열과 섹션 목록이 같은 규칙을 써야 해서 컴포넌트 밖에 둔다.
 */

const GITHUB_URL_PREFIX = /^https?:\/\/github\.com\//;

/** 제목 자리에 올릴 저장소 이름(owner/repo). 짧은 식별자가 없는 출처는 null. */
export function repoLabelOf(item: TrendItemRow): string | null {
  if (item.source !== "github") return null;

  const raw = item.raw_title?.trim();
  if (raw) return raw;

  // raw_title 이 비어 있어도 PK 가 https://github.com/{owner}/{repo} 라 복구할 수 있다.
  const fromUrl = item.source_url.replace(GITHUB_URL_PREFIX, "").replace(/\/+$/, "");
  return fromUrl && fromUrl !== item.source_url ? fromUrl : null;
}

/** 출처별 지표 문구 — GitHub 은 별, HN 은 댓글, arXiv 는 논문 번호 */
function metricOf(item: TrendItemRow): string | null {
  const m = item.metrics ?? {};
  switch (item.source) {
    case "github": {
      const stars = m.stars_in_period ?? m.stars;
      const period =
        item.source_variant === "weekly"
          ? "this week"
          : item.source_variant === "monthly"
            ? "this month"
            : "today";
      return stars ? `★ ${Number(stars).toLocaleString("ko-KR")} ${period}` : null;
    }
    case "hn":
      return m.comments ? `${m.comments} comments` : null;
    case "arxiv":
      return m.arxiv_id ? `arXiv:${m.arxiv_id}` : null;
    case "geeknews":
      return m.points ? `${m.points} points` : null;
  }
}

/**
 * 메타 줄의 지표 문구 — "★ 4,812 this week · Python".
 *
 * 수집 날짜는 여기 넣지 않는다. 좁은 열에서 이 줄은 한 줄 말줄임이라, 날짜를 같이
 * 넣으면 제일 뒤에 붙은 날짜부터 잘려 나간다. 호출부가 날짜를 별도 요소로 앞에 둔다.
 */
export function metaTextOf(item: TrendItemRow): string {
  const parts: string[] = [];

  const metric = metricOf(item);
  if (metric) parts.push(metric);

  const language = item.metrics?.language;
  if (typeof language === "string" && language.trim()) parts.push(language.trim());

  return parts.join(" · ");
}

/**
 * 목록 행에 붙는 수집 날짜 — "08.21".
 *
 * trend_items 에는 원문 발행일 컬럼이 없어 collected_date 가 유일한 시간 정보다.
 * 행마다 붙여, 수집이 밀려 어제 것이 걸려 있어도 바로 알아보게 한다.
 */
export function collectedLabelOf(item: TrendItemRow): string | null {
  return item.collected_date ? shortDot(item.collected_date) : null;
}
