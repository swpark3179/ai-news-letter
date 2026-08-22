import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import ArticleComposer from "@/components/compose/ArticleComposer";
import { getSessionUser } from "@/lib/auth/current-user";
import { canEditArticle } from "@/lib/auth/permissions";
import { getArticleFull, getUnitMembers } from "@/lib/data/content";
import { getArticleAttachment } from "@/lib/data/ops";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const a = await getArticleFull(id).catch(() => null);
  return { title: a ? `수정 · ${a.title}` : "글 수정" };
}

export default async function EditArticlePage({ params }: Props) {
  const { id } = await params;

  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/articles/${id}/edit`);

  const article = await getArticleFull(id);
  if (!article) notFound();

  // 권한이 없으면 글이 있다는 사실도 알리지 않는다.
  if (!canEditArticle(user, article)) notFound();

  const [members, attachment] = await Promise.all([
    user.isAdmin ? getUnitMembers() : Promise.resolve([]),
    getArticleAttachment(article.id),
  ]);

  return (
    <ArticleComposer
      mode="edit"
      viewer={user}
      initialSection={article.section}
      initial={article}
      canPickAuthor={user.isAdmin}
      members={members.map((m) => ({ id: m.id, name: m.name, role: m.role }))}
      attachedFileName={attachment?.file_name ?? null}
    />
  );
}
