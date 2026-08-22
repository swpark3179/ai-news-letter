"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ADMIN_NAV, MAX_SINGLE_TRANSFER_BYTES } from "@/lib/domain";
import { mb } from "@/lib/format";
import s from "./admin.module.css";

/** 관리자 LNB (디자인 661~673행) */
export default function AdminNav() {
  const pathname = usePathname() ?? "/admin";

  return (
    <aside>
      <div className={s.lnbCard}>
        <div className={s.lnbTitle}>관리자 콘솔</div>
        <div className={s.lnbList}>
          {ADMIN_NAV.map((n) => {
            const base = n.href.split("#")[0];
            const on =
              base === "/admin"
                ? pathname === "/admin"
                : pathname === base || pathname.startsWith(`${base}/`);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`${s.lnbItem} ${on ? s.lnbItemOn : ""}`}
              >
                <span className={`${s.lnbDot} ${on ? s.lnbDotOn : ""}`} />
                {n.label}
              </Link>
            );
          })}
        </div>
        <div className={s.lnbNotice}>
          사내 업로드 정책: 1회 전송 최대{" "}
          <strong>{mb(MAX_SINGLE_TRANSFER_BYTES, 0)}</strong>. 초과 파일은 분할 암호화
          전송으로 자동 처리됩니다.
        </div>
      </div>
    </aside>
  );
}
