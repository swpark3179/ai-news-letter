import { Noto_Sans_KR, Roboto_Mono, Sora } from "next/font/google";

/**
 * 디자인 시스템의 세 가지 타입페이스.
 *
 * 원본 colors_and_type.css 는 Noto Sans KR TTF 9종을 직접 @font-face 로 물리고
 * 나머지는 Google Fonts @import 로 받았다. Next 에서는 next/font 가 빌드 시점에
 * 내려받아 self-host 하므로 런타임 외부 요청이 없다 (사내망에서도 동작).
 *
 * 각 폰트가 노출하는 CSS 변수를 tokens.css 의 --font-sans / --font-mono /
 * --font-display 가 참조한다.
 */

export const notoSansKr = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-noto-sans-kr",
  display: "swap",
});

export const sora = Sora({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sora",
  display: "swap",
});

export const robotoMono = Roboto_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-roboto-mono",
  display: "swap",
});

export const fontVariables = [
  notoSansKr.variable,
  sora.variable,
  robotoMono.variable,
].join(" ");
