import Link from "next/link";
import { CATEGORIES } from "@/lib/domain";
import { routes } from "@/lib/routes";
import type { CategoryKey } from "@/types/db";
import s from "./section.module.css";

/**
 * 다섯 카테고리 알약. 검색어가 있으면 그대로 들고 옮겨 간다 —
 * 「이 말이 다른 카테고리에도 있나」를 탭 하나로 확인할 수 있게.
 */
export default function CategoryTabs({ current, q }: { current?: CategoryKey; q?: string }) {
  return (
    <nav className={s.filters} aria-label="카테고리">
      {CATEGORIES.map((c) => (
        <Link
          key={c.key}
          href={routes.category(c.key, { q })}
          className={`${s.filter} ${current === c.key ? s.filterOn : ""}`}
          aria-current={current === c.key ? "page" : undefined}
        >
          {c.ko}
        </Link>
      ))}
    </nav>
  );
}
