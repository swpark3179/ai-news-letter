import { redirect } from "next/navigation";
import Header from "@/components/site/Header";
import AdminNav from "@/components/admin/AdminNav";
import SetupNotice from "@/components/ui/SetupNotice";
import { getViewer } from "@/lib/auth/current-user";
import { missingSupabaseEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import s from "@/components/admin/admin.module.css";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const wrapperStyle = {
    fontFamily: "var(--font-sans)",
    color: "var(--gray-900)",
    background: "var(--bg-canvas)",
    minHeight: "100vh",
  } as const;

  const missing = missingSupabaseEnv();
  if (missing.length > 0) {
    return (
      <div style={wrapperStyle}>
        <SetupNotice missing={missing} />
      </div>
    );
  }

  const { user } = await getViewer();
  if (!user) redirect("/login?next=/admin");

  // proxy 가 JWT 의 isAdmin 을 이미 확인했지만, 권한이 회수된 뒤에도 오래된 쿠키로
  // 들어올 수 있으므로 DB 를 한 번 더 본다.
  const { data } = await supabaseAdmin()
    .from("members")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle<{ is_admin: boolean }>();

  if (!data?.is_admin) redirect("/");

  return (
    <div style={wrapperStyle}>
      <Header user={user} guest={false} />
      <div className={s.shell}>
        <AdminNav />
        <div>{children}</div>
      </div>
    </div>
  );
}
