"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AVATAR_TONES, NAV_ITEMS } from "@/lib/domain";
import type { AvatarTone } from "@/types/db";
import type { SessionUser } from "@/lib/auth/session";
import s from "./Header.module.css";

interface Props {
  user: SessionUser | null;
  guest: boolean;
}

function isActive(pathname: string, match: string): boolean {
  if (match === "/") return pathname === "/";
  return pathname === match || pathname.startsWith(`${match}/`);
}

export default function Header({ user, guest }: Props) {
  const pathname = usePathname() ?? "/";
  const tone = AVATAR_TONES[(user?.avatarTone as AvatarTone) ?? "purple"] ?? AVATAR_TONES.purple;

  return (
    <>
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

            {user && (
              <Link
                href="/me"
                title="내 보관함 — 나중에 다시 읽으려고 담아 둔 게시물"
                className={`${s.savedBtn} ${
                  isActive(pathname, "/me") ? s.savedBtnOn : ""
                }`}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z" />
                </svg>
                보관함
              </Link>
            )}

            {user?.isAdmin && (
              <Link href="/admin" className={s.adminBtn}>
                관리자
              </Link>
            )}

            {user ? (
              <Link
                href="/me"
                className={s.avatar}
                style={{ background: tone.bg, color: tone.fg }}
                title={user.name}
              >
                {user.initial ?? user.name.slice(-2)}
              </Link>
            ) : (
              <Link href="/login" className={s.loginBtn}>
                로그인
              </Link>
            )}
          </div>
        </div>
      </header>

      {guest && (
        <div className={s.guestWrap}>
          <div className={s.guestBanner}>
            <span className={s.guestText}>
              로그인 없이 보는 중 · 공개 기사만 열람되며 스크랩과 코멘트는 로그인 후 사용할 수
              있습니다
            </span>
            <Link href="/login" className={s.guestLogin}>
              로그인
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
