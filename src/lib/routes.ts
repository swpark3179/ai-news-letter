import type { SectionKey } from "@/types/db";

/**
 * 링크 경로를 한 곳에서 만든다.
 *
 * 트렌드 브리핑 항목의 PK 는 원본 URL 이라 주소에 그대로 넣을 수 없다.
 * DB 의 generated column public_id(= md5(source_url) 앞 12자)를 쓴다.
 */

export const routes = {
  home: "/",

  section(key: SectionKey, filter?: string): string {
    return filter && filter !== "all"
      ? `/sections/${key}?filter=${filter}`
      : `/sections/${key}`;
  },

  /** 트렌드 행은 public_id 가 항상 있다 (generated column). 없으면 목록으로 보낸다. */
  trend(item: { public_id: string | null }): string {
    return item.public_id ? `/articles/trend/${item.public_id}` : "/sections/trend";
  },
};
