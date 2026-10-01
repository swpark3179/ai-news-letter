import Form from "next/form";
import s from "./section.module.css";

/**
 * 검색 입력 — GET 폼이라 주소가 곧 검색 상태다 (?q=). 자바스크립트 없이도 동작하고,
 * 있으면 next/form 이 클라이언트 이동으로 바꿔 준다.
 */
export default function SearchBox({
  action,
  q,
  placeholder,
}: {
  action: string;
  q?: string;
  placeholder: string;
}) {
  return (
    <Form action={action} className={s.search} role="search">
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={100}
        className={s.searchInput}
      />
      <button type="submit" className={s.searchBtn}>
        검색
      </button>
    </Form>
  );
}
