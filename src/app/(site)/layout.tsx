import { getViewer } from "@/lib/auth/current-user";
import { missingSupabaseEnv } from "@/lib/env";
import Header from "@/components/site/Header";
import SetupNotice from "@/components/ui/SetupNotice";

export default async function SiteLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const missing = missingSupabaseEnv();

  const shell = (inner: React.ReactNode, header: React.ReactNode) => (
    <div
      style={{
        fontFamily: "var(--font-sans)",
        color: "var(--gray-900)",
        background: "var(--bg-canvas)",
        minHeight: "100vh",
      }}
    >
      {header}
      {inner}
    </div>
  );

  // Supabase 설정 전에는 DB 를 건드리지 않고 안내만 보여 준다.
  if (missing.length > 0) {
    return shell(<SetupNotice missing={missing} />, null);
  }

  const { user, guest } = await getViewer();
  return shell(children, <Header user={user} guest={guest} />);
}
