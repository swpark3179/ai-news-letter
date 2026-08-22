"use client";

import { DEFAULT_CHUNK_BYTES } from "@/lib/domain";

/**
 * 분할 암호화 업로드 (클라이언트).
 *
 * 사내 게이트웨이가 1회 전송 10MB 를 넘기지 못하므로 파일을 조각내 보낸다.
 * 각 조각은 AES-256-GCM 으로 암호화한 뒤 전송하고, 서버가 복호화해 Storage 에
 * 합친다 (디자인의 5단계 진행바에 대응).
 *
 * 키는 서버가 업로드 단위로 생성해 init 응답으로 내려준다. 조각마다 새 IV(12B)를
 * 만들어 [IV | ciphertext+tag] 형태로 붙여 보낸다.
 */

export type UploadStage =
  | "split"      // 조각 분할
  | "encrypt"    // 클라이언트 암호화
  | "transfer"   // 순차 전송
  | "decrypt"    // 서버 복호화
  | "store";     // DB/Storage 저장

export interface ChunkState {
  index: number;
  sizeBytes: number;
  /** 0~100 */
  pct: number;
  stage: UploadStage;
}

export interface UploadProgress {
  attachmentId: string;
  chunks: ChunkState[];
  /** 0~100 */
  overallPct: number;
  transferredBytes: number;
  done: boolean;
}

export interface StartUploadArgs {
  file: File;
  articleId?: string | null;
  chunkBytes?: number;
  /** 조각 사이 대기 시간 (디자인의 속도 프로파일) */
  throttleMs?: number;
  onProgress: (p: UploadProgress) => void;
  signal?: AbortSignal;
}

interface InitResponse {
  attachmentId: string;
  chunkCount: number;
  chunkSizeBytes: number;
  keyB64: string;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt"]);
}

export async function startChunkedUpload(args: StartUploadArgs): Promise<string> {
  const { file, articleId, onProgress, signal } = args;
  const chunkBytes = args.chunkBytes ?? DEFAULT_CHUNK_BYTES;
  const throttleMs = args.throttleMs ?? 0;

  // --- 1. init -------------------------------------------------------------
  const initRes = await fetch("/api/uploads/init", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      fileName: file.name,
      sizeBytes: file.size,
      mimeType: file.type || "application/octet-stream",
      chunkSizeBytes: chunkBytes,
      articleId: articleId ?? null,
    }),
    signal,
  });

  if (!initRes.ok) {
    const j = (await initRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "업로드를 시작하지 못했습니다.");
  }

  const init = (await initRes.json()) as InitResponse;
  const key = await importKey(init.keyB64);

  // --- 2. 조각 분할 --------------------------------------------------------
  const chunks: ChunkState[] = Array.from({ length: init.chunkCount }, (_, i) => {
    const start = i * init.chunkSizeBytes;
    const end = Math.min(file.size, start + init.chunkSizeBytes);
    return { index: i, sizeBytes: end - start, pct: 0, stage: "split" as UploadStage };
  });

  let transferred = 0;

  const report = (done = false) => {
    const overall =
      chunks.length === 0
        ? 0
        : chunks.reduce((a, c) => a + c.pct, 0) / chunks.length;
    onProgress({
      attachmentId: init.attachmentId,
      chunks: [...chunks],
      overallPct: Math.round(overall),
      transferredBytes: transferred,
      done,
    });
  };

  report();

  // --- 3. 조각별 암호화 → 전송 --------------------------------------------
  for (const c of chunks) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const start = c.index * init.chunkSizeBytes;
    const blob = file.slice(start, start + c.sizeBytes);
    const plain = new Uint8Array(await blob.arrayBuffer());

    c.stage = "encrypt";
    c.pct = 25;
    report();

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain),
    );

    // [IV(12B) | ciphertext + tag]
    const payload = new Uint8Array(iv.length + cipher.length);
    payload.set(iv, 0);
    payload.set(cipher, iv.length);

    c.stage = "transfer";
    c.pct = 50;
    report();

    const res = await fetch("/api/uploads/chunk", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-attachment-id": init.attachmentId,
        "x-chunk-index": String(c.index),
      },
      body: payload as BodyInit,
      signal,
    });

    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      c.stage = "transfer";
      throw new Error(j.error ?? `조각 ${c.index + 1} 전송에 실패했습니다.`);
    }

    c.stage = "decrypt";
    c.pct = 80;
    report();

    transferred += c.sizeBytes;
    c.stage = "store";
    c.pct = 100;
    report();

    if (throttleMs > 0) await new Promise((r) => setTimeout(r, throttleMs));
  }

  // --- 4. 합치기 -----------------------------------------------------------
  const doneRes = await fetch("/api/uploads/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ attachmentId: init.attachmentId }),
    signal,
  });

  if (!doneRes.ok) {
    const j = (await doneRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(j.error ?? "파일 조립에 실패했습니다.");
  }

  report(true);
  return init.attachmentId;
}

export const STAGE_LABELS: Record<UploadStage, string> = {
  split: "대기",
  encrypt: "암호화",
  transfer: "전송 중",
  decrypt: "서버 복호화",
  store: "저장 완료",
};

export const STAGE_ORDER: UploadStage[] = [
  "split",
  "encrypt",
  "transfer",
  "decrypt",
  "store",
];

export const STAGE_STEP_LABELS = [
  "조각 분할",
  "클라이언트 암호화",
  "순차 전송",
  "서버 복호화",
  "DB 저장",
];

/** 디자인의 속도 프로파일 3종 (조각 사이 대기로 구현) */
export const SPEED_PROFILES = [
  { label: "야간 절약 0.6MB/s", throttleMs: 2200 },
  { label: "표준 2.4MB/s", throttleMs: 600 },
  { label: "우선 6.0MB/s", throttleMs: 0 },
];
