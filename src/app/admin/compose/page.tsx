import { redirect } from "next/navigation";
import { routes } from "@/lib/routes";

/**
 * 글 작성은 사용자 화면(각 카테고리 메뉴)으로 옮겼다.
 * 기존 북마크와 링크를 살려 두기 위해 리다이렉트만 남긴다.
 */
export default async function ComposeRedirect({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const { section } = await searchParams;
  redirect(routes.sectionWrite(section === "deep" ? "deep" : "review"));
}
