import type { Metadata, Viewport } from "next";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AI 뉴스레터",
    template: "%s · AI 뉴스레터",
  },
  description:
    "매일 아침 7시, 흩어진 AI 소식을 한 장으로 · 유닛의 리뷰와 심층 분석을 함께",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={fontVariables}>
      <body>{children}</body>
    </html>
  );
}
