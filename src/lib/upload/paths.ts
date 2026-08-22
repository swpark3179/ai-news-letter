/** Storage 경로 규칙 — 업로드 라우트들이 공유한다. */

/** 조립 전 임시 조각. complete 단계에서 지운다. */
export function chunkPath(attachmentId: string, index: number): string {
  return `tmp/${attachmentId}/${String(index).padStart(5, "0")}`;
}

export function chunkPrefix(attachmentId: string): string {
  return `tmp/${attachmentId}`;
}

/** 파일명에서 경로 조작 문자를 걷어낸다. */
export function safeFileName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_").slice(0, 180) || "file";
}

export function finalPath(attachmentId: string, fileName: string): string {
  return `attachments/${attachmentId}/${safeFileName(fileName)}`;
}

/** 기사 대표 사진 */
export function photoPath(articleId: string, fileName: string): string {
  return `photos/${articleId}/${safeFileName(fileName)}`;
}
