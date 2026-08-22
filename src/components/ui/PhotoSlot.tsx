import Image from "next/image";
import s from "./PhotoSlot.module.css";

interface Props {
  /** Supabase Storage 공개 URL. 없으면 플레이스홀더를 보여준다. */
  src?: string | null;
  alt?: string;
  placeholder: string;
  /** 부모가 position:relative + 고정 높이를 갖고 있어야 한다. */
  rounded?: boolean;
}

/**
 * 디자인의 <image-slot> 을 대체한다.
 * 사진이 아직 없으면 회색 박스에 안내 문구를 띄운다.
 */
export default function PhotoSlot({ src, alt, placeholder, rounded }: Props) {
  if (!src) {
    return (
      <div className={`${s.empty} ${rounded ? s.rounded : ""}`}>
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden
        >
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.6" />
          <path d="m3 16 5-4 4 3 3-2 6 5" />
        </svg>
        <span className={s.label}>{placeholder}</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt ?? placeholder}
      fill
      sizes="(max-width: 1280px) 50vw, 640px"
      className={`${s.image} ${rounded ? s.rounded : ""}`}
    />
  );
}
