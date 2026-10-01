import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 서버 번들에 넣지 않고 런타임에 node_modules 에서 불러온다.
  // instrumentation.ts → lib/proxy.ts 가 쓰는 undici 는 Node 전용 모듈이다.
  serverExternalPackages: ["undici"],
};

export default nextConfig;
