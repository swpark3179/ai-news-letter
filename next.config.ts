import type { NextConfig } from "next";

/**
 * Supabase Storage 호스트를 next/image 에 허용한다.
 * SUPABASE_URL 이 아직 없으면(초기 셋업 중) 패턴을 비워 둔다 — 이때는 화면에
 * 사진 대신 플레이스홀더가 뜨므로 빌드가 깨지지 않는다.
 */
function supabaseImagePatterns() {
  const url = process.env.SUPABASE_URL?.trim();
  if (!url) return [];
  try {
    const { hostname } = new URL(url);
    return [
      {
        protocol: "https" as const,
        hostname,
        pathname: "/storage/v1/object/**",
      },
    ];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseImagePatterns(),
  },

  // 서버 번들에만 들어가야 하는 패키지 (수집 스크립트와 공유하는 모듈들)
  serverExternalPackages: ["cheerio", "undici"],
};

export default nextConfig;
