"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "@/lib/domain";
import s from "./Header.module.css";

function isActive(pathname: string, match: readonly string[]): boolean {
  return match.some((m) =>
    m === "/" ? pathname === "/" : pathname === m || pathname.startsWith(`${m}/`),
  );
}

export default function Header() {
  const pathname = usePathname() ?? "/";

  return (
    <header className={s.header}>
      <div className={s.inner}>
        <Link href="/" className={s.logo}>
          <div className={s.logoMark}>AI</div>
          <div className={s.logoText}>뉴스레터</div>
        </Link>

        <nav className={`${s.nav} no-scrollbar`}>
          {NAV_ITEMS.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`${s.navItem} ${isActive(pathname, n.match) ? s.navItemActive : ""}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className={s.right}>
          <Link
            href="/search"
            title="기사 · 저장소 · 논문 검색"
            aria-label="검색"
            className={s.iconBtn}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </Link>
        </div>
      </div>
    </header>
  );
}
