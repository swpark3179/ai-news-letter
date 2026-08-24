import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/current-user";
import { supabaseAdmin } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * 보관함 담기 / 빼기.
 *
 * 목표 상태(saved)를 그대로 받는다. 토글이 아니라 멱등이라, 버튼을 빠르게 두 번
 * 누르거나 다른 탭에서 이미 담아 둔 경우에도 화면에 보이는 상태와 DB 가 어긋나지
 * 않는다.
 *
 * 게스트는 세션이 없어 401 이다 (헤더의 노란 배너가 안내하는 그대로).
 */

const bodySchema = z.object({
  targetType: z.enum(["geek", "trend"]),
  // 긱뉴스·트렌드의 키는 원문 URL 이다. 지나치게 긴 값은 받지 않는다.
  targetKey: z.string().trim().min(1).max(2048),
  saved: z.boolean(),
});

export async function POST(req: Request) {
  const user = await getSessionUser(req);
  if (!user) {
    return NextResponse.json(
      { error: "보관은 로그인 후 사용할 수 있습니다." },
      { status: 401 },
    );
  }

  let parsed;
  try {
    parsed = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }

  const { targetType, targetKey, saved } = parsed;
  const db = supabaseAdmin();

  if (saved) {
    // 없는 게시물 키로 행이 쌓이면 보관함과 통계에 유령 항목이 남는다.
    const exists = await targetExists(targetType, targetKey);
    if (!exists) {
      return NextResponse.json({ error: "게시물을 찾을 수 없습니다." }, { status: 404 });
    }

    const { error } = await db
      .from("scraps")
      .upsert(
        { member_id: user.id, target_type: targetType, target_key: targetKey },
        { onConflict: "member_id,target_type,target_key", ignoreDuplicates: true },
      );

    if (error) {
      return NextResponse.json(
        { error: `보관에 실패했습니다: ${error.message}` },
        { status: 500 },
      );
    }
  } else {
    const { error } = await db
      .from("scraps")
      .delete()
      .eq("member_id", user.id)
      .eq("target_type", targetType)
      .eq("target_key", targetKey);

    if (error) {
      return NextResponse.json(
        { error: `보관 취소에 실패했습니다: ${error.message}` },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ saved, targetType, targetKey });
}

async function targetExists(
  targetType: "geek" | "trend",
  targetKey: string,
): Promise<boolean> {
  const db = supabaseAdmin();

  if (targetType === "geek") {
    const { data } = await db
      .from("geek_news")
      .select("url")
      .eq("url", targetKey)
      .eq("is_hidden", false)
      .maybeSingle<{ url: string }>();
    return !!data;
  }

  const { data } = await db
    .from("trend_items")
    .select("source_url, status")
    .eq("source_url", targetKey)
    .maybeSingle<{ source_url: string; status: string }>();

  return !!data && data.status !== "hidden";
}
