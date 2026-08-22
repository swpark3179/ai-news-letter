import Link from "next/link";
import type { Metadata } from "next";
import s from "@/components/admin/admin.module.css";
import { routes } from "@/lib/routes";
import { dashDate, hhmm, mb } from "@/lib/format";
import { getAttachments, storageUrl } from "@/lib/data/ops";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "업로드 이력" };

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  stored: { label: "저장 완료", bg: "var(--green-50)", fg: "var(--green-700)" },
  assembling: { label: "조립 중", bg: "var(--yellow-50)", fg: "var(--yellow-800)" },
  uploading: { label: "전송 중", bg: "var(--blue-50)", fg: "var(--blue-700)" },
  pending: { label: "대기", bg: "var(--gray-100)", fg: "var(--gray-700)" },
  failed: { label: "실패", bg: "var(--red-50)", fg: "var(--red-700)" },
};

export default async function UploadsPage() {
  const rows = await getAttachments(50);

  return (
    <>
      <div className={s.pageHead}>
        <div>
          <div className={s.pageTitle}>업로드 이력</div>
          <div className={s.pageSub}>
            사내 1회 전송 한도 10MB 를 넘는 발표 자료는 조각으로 나눠 AES-256-GCM 으로
            암호화 전송하고, 서버가 복호화해 합칩니다.
          </div>
        </div>
        <Link href={routes.sectionWrite("deep")} className={s.ghostBtn}>
          새 발표 자료 올리기
        </Link>
      </div>

      <div className={s.tableCard}>
        <div className={s.tableTitle}>최근 업로드</div>
        <div
          className={s.tableHead}
          style={{ gridTemplateColumns: "minmax(0,1fr) 110px 130px 110px 90px" }}
        >
          <div>파일</div>
          <div>크기</div>
          <div>조각</div>
          <div>일시</div>
          <div>상태</div>
        </div>

        {rows.length === 0 ? (
          <div className={s.tableEmpty}>아직 업로드된 파일이 없습니다.</div>
        ) : (
          rows.map((f) => {
            const st = STATUS[f.status] ?? STATUS.pending;
            const url = f.status === "stored" ? storageUrl(f.storage_path) : null;
            const Row = (
              <>
                <div className={s.cellTitle}>{f.file_name}</div>
                <div className={s.cellMuted}>{mb(f.size_bytes, 1)}</div>
                <div className={s.cellMuted}>
                  {f.received_chunks}/{f.chunk_count} · 조각당 {mb(f.chunk_size_bytes, 0)}
                </div>
                <div className={s.cellMono}>
                  {dashDate(f.created_at)} {hhmm(f.created_at)}
                </div>
                <div>
                  <span
                    className={s.statusPill}
                    style={{ background: st.bg, color: st.fg }}
                  >
                    {st.label}
                  </span>
                </div>
              </>
            );

            return url ? (
              <a
                key={f.id}
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                className={s.tableRow}
                style={{ gridTemplateColumns: "minmax(0,1fr) 110px 130px 110px 90px" }}
              >
                {Row}
              </a>
            ) : (
              <div
                key={f.id}
                className={s.tableRow}
                style={{ gridTemplateColumns: "minmax(0,1fr) 110px 130px 110px 90px" }}
                title={f.error ?? undefined}
              >
                {Row}
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
