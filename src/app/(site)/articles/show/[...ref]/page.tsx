import type { Metadata } from "next";
import HadaArticle, { hadaTitle } from "@/components/article/HadaArticle";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ ref: string[] }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { ref } = await params;
  return { title: await hadaTitle("show", ref) };
}

/** /articles/show/34578 — 키 모양은 lib/routes.ts 의 routes.hada 참고 */
export default async function ShowArticlePage({ params }: Props) {
  const { ref } = await params;
  return <HadaArticle kind="show" segments={ref} />;
}
