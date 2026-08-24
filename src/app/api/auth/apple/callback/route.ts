import { NextResponse } from "next/server";
import { socialAuthEnv } from "@/lib/env";

export const runtime = "nodejs";

/**
 * Android 의 Apple 로그인이 앱으로 돌아오는 다리.
 *
 * **iOS 에는 필요 없다.** iOS 는 OS 가 인증 시트를 직접 띄우고 결과를 앱에
 * 그대로 돌려주므로 리디렉션이 없다. 반면 Android 에는 Apple 의 네이티브
 * SDK 가 없어서 이런 왕복을 거친다.
 *
 *   앱 → 커스텀 탭으로 appleid.apple.com 열기
 *      → 사용자가 인증
 *      → Apple 이 **이 라우트로 POST** (response_mode=form_post)
 *      → 여기서 signinwithapple://callback 로 302
 *      → 앱의 SignInWithAppleCallback 액티비티가 받음
 *      → 앱이 /api/auth/apple 로 ID 토큰을 보냄
 *
 * 그러니 이 라우트는 **아무것도 검증하지 않는다.** 토큰의 서명·aud·nonce 는
 * 다음 단계인 `/api/auth/apple` 이 검사한다. 여기서 하는 일은 폼 필드를
 * 그대로 앱으로 넘기는 것뿐이다.
 *
 * Apple Developer 의 Services ID 에 이 주소를 Return URL 로 등록해야 하고,
 * **https 여야 한다** (localhost 도 안 된다). 절차는 모바일 저장소
 * docs/13-apple-signin-setup.md.
 */

// 되돌아갈 앱과 스킴은 socialAuthEnv 에서 읽는다(env.ts).

/**
 * 앱이 등록한 스킴. `android:scheme` 과 같아야 한다.
 * (android/app/src/main/AndroidManifest.xml 의 SignInWithAppleCallback)
 */
const CALLBACK_SCHEME = "signinwithapple";

export async function POST(req: Request) {
  let params: URLSearchParams;
  try {
    const form = await req.formData();
    params = new URLSearchParams();
    // forEach 를 쓰는 이유: entries() 는 tsconfig 의 lib 에 dom.iterable 이
    // 있어야 타입이 잡힌다. 이 파일은 다른 저장소로 옮겨 가므로 기본 lib 로도
    // 컴파일되는 쪽을 쓴다.
    form.forEach((value, key) => {
      if (typeof value === "string") params.set(key, value);
    });
  } catch {
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
  }
  return toApp(params);
}

/**
 * 범위를 요청하지 않은 흐름에서는 Apple 이 쿼리스트링으로 GET 을 보낸다.
 * 우리는 email·fullName 을 요청하므로 실제로는 POST 만 오지만,
 * 설정이 바뀌었을 때 조용히 실패하지 않도록 함께 받아 둔다.
 */
export async function GET(req: Request) {
  return toApp(new URL(req.url).searchParams);
}

function toApp(params: URLSearchParams): Response {
  // intent: 스킴은 URL 로 파싱되지 않으므로 헤더를 직접 만든다.
  // 307 이어야 앱이 원래 요청 방식을 잃지 않는다.
  const location =
    `intent://callback?${params.toString()}` +
    `#Intent;package=${socialAuthEnv.appleAndroidPackage};scheme=${CALLBACK_SCHEME};end`;

  return new Response(null, { status: 307, headers: { Location: location } });
}
