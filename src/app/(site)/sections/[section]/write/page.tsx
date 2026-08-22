import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import ArticleComposer from "@/components/compose/ArticleComposer";
import { SECTION_MAP } from "@/lib/domain";
import { getSessionUser } from "@/lib/auth/current-user";
import { getMyDraft, getUnitMembers } from "@/lib/data/content";
import { getArticleAttachment } from "@/lib/data/ops";
import type { WritableSection } from "@/types/db";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ section: string }>;
}

function writableSection(v: string): WritableSection | null {
  return v === "review" || v === "deep" ? v : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { section } = await params;
  const key = writableSection(section);
  return { title: key ? `글 쓰기 · ${SECTION_MAP[key].ko}` : "글 쓰기" };
}

/**
 * 사용자 화면의 글 등록.
 *
 * 긱뉴스 · 트렌드 브리핑은 자동 수집 카테고리라 여기로 들어올 수 없다.
 * 같은 카테고리에 임시저장해 둔 글이 있으면 그대로 불러와 이어쓴다.
 */
export default async function WritePage({ params }: Props) {
  const { section } = await params;
  const key = writableSection(section);
  if (!key) notFound();

  // 게스트는 열람만 가능하다 — proxy 는 통과하므로 여기서 막는다.
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/sections/${key}/write`);

  const [draft, members] = await Promise.all([
    getMyDraft(user.id, key),
    user.isAdmin ? getUnitMembers() : Promise.resolve([]),
  ]);

  const attachment = draft ? await getArticleAttachment(draft.id) : null;

  return (
    <ArticleComposer
      mode="create"
      viewer={user}
      initialSection={key}
      initial={draft}
      canPickAuthor={user.isAdmin}
      members={members.map((m) => ({ id: m.id, name: m.name, role: m.role }))}
      attachedFileName={attachment?.file_name ?? null}
    />
  );
}
