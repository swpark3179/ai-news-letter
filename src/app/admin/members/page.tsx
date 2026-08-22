import type { Metadata } from "next";
import s from "@/components/admin/admin.module.css";
import { ROLE_LABEL, avatarOf } from "@/lib/domain";
import { getRotations, getUnitMembers } from "@/lib/data/content";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "유닛 멤버" };

const ROTATION_STATUS: Record<string, string> = {
  done: "완료",
  preparing: "준비 중",
  reviewing: "검토 중",
  planned: "예정",
};

export default async function MembersPage() {
  const [members, deep, weekly] = await Promise.all([
    getUnitMembers(),
    getRotations("deep", 12),
    getRotations("weekly", 12),
  ]);

  return (
    <>
      <div className={s.pageHead}>
        <div>
          <div className={s.pageTitle}>유닛 멤버</div>
          <div className={s.pageSub}>
            사내 SSO 로 처음 로그인하면 구독자로 등록되고, 유닛원 승격과 관리자 권한은
            Supabase 의 members 테이블에서 지정합니다.
          </div>
        </div>
      </div>

      <div className={s.tableCard}>
        <div className={s.tableTitle}>유닛원</div>
        <div
          className={s.tableHead}
          style={{ gridTemplateColumns: "minmax(0,1fr) 120px 120px 100px 90px" }}
        >
          <div>이름</div>
          <div>사번</div>
          <div>역할</div>
          <div>부서</div>
          <div>관리자</div>
        </div>
        {members.map((m) => {
          const av = avatarOf(m);
          return (
            <div
              key={m.id}
              className={s.tableRow}
              style={{ gridTemplateColumns: "minmax(0,1fr) 120px 120px 100px 90px" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "var(--radius-full)",
                    background: av.bg,
                    color: av.fg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {av.init}
                </span>
                <span className={s.cellTitle}>{m.name}</span>
              </div>
              <div className={s.cellMono}>{m.emp_no}</div>
              <div className={s.cellMuted}>{ROLE_LABEL[m.role]}</div>
              <div className={s.cellMuted}>{m.dept ?? "—"}</div>
              <div>
                <span
                  className={s.statusPill}
                  style={{
                    background: m.is_admin ? "var(--purple-50)" : "var(--gray-100)",
                    color: m.is_admin ? "var(--purple-700)" : "var(--gray-600)",
                  }}
                >
                  {m.is_admin ? "관리자" : "일반"}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ height: 20 }} />

      <div className={s.tableCard}>
        <div className={s.tableTitle}>발표 순번 · 주간 당번</div>
        <div
          className={s.tableHead}
          style={{ gridTemplateColumns: "100px minmax(0,1fr) 160px 120px" }}
        >
          <div>구분</div>
          <div>담당 · 주제</div>
          <div>기간</div>
          <div>상태</div>
        </div>
        {[...deep, ...weekly].map((r) => (
          <div
            key={r.id}
            className={s.tableRow}
            style={{ gridTemplateColumns: "100px minmax(0,1fr) 160px 120px" }}
          >
            <div className={s.cellMuted}>{r.kind === "deep" ? "심층 발표" : "주간 리뷰"}</div>
            <div className={s.cellTitle}>
              {r.member?.name ?? "미지정"}
              {r.topic ? ` · ${r.topic}` : ""}
            </div>
            <div className={s.cellMono}>{r.period_label}</div>
            <div className={s.cellMuted}>{ROTATION_STATUS[r.status] ?? r.status}</div>
          </div>
        ))}
      </div>
    </>
  );
}
