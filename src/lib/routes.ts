import type {
  ArticleRow,
  SectionKey,
  TrendItemRow,
  WritableSection,
} from "@/types/db";

/**
 * 링크 경로를 한 곳에서 만든다.
 *
 * 트렌드 브리핑 항목의 PK 는 원본 URL 이라 주소에 그대로 넣을 수 없다.
 * DB 의 generated column public_id(= md5(source_url) 앞 12자)를 쓴다.
 */

export const routes = {
  home: "/",
  login: "/login",
  meetings: "/meetings",
  admin: "/admin",
  adminUploads: "/admin/uploads",

  section(key: SectionKey, filter?: string): string {
    return filter && filter !== "all"
      ? `/sections/${key}?filter=${filter}`
      : `/sections/${key}`;
  },

  trend(item: Pick<TrendItemRow, "public_id">): string {
    return `/articles/trend/${item.public_id}`;
  },

  article(a: Pick<ArticleRow, "id">): string {
    return `/articles/${a.id}`;
  },

  /** 사용자 화면의 글 등록 — 위클리 리뷰 / 심층 분석만 작성 가능하다. */
  sectionWrite(section: WritableSection): string {
    return `/sections/${section}/write`;
  },

  articleEdit(a: Pick<ArticleRow, "id">): string {
    return `/articles/${a.id}/edit`;
  },
};
