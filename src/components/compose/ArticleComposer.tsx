"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { SECTION_MAP, SRC } from "@/lib/domain";
import { routes } from "@/lib/routes";
import { dotDate, mb } from "@/lib/format";
import {
  SPEED_PROFILES,
  STAGE_STEP_LABELS,
  startChunkedUpload,
  type UploadProgress,
} from "@/lib/upload/chunked";
import type { SessionUser } from "@/lib/auth/session";
import {
  TABLE_MAX_COLS,
  TABLE_MAX_ROWS,
  blockHasContent,
  blockPlainText,
} from "@/lib/blocks";
import BlockTable, { formatClass } from "@/components/article/BlockTable";
import type {
  ArticleFull,
  Block,
  BlockAlign,
  BlockColor,
  BlockSize,
  BlockType,
  SourceKind,
  WritableSection,
} from "@/types/db";
import s from "./compose.module.css";

interface DraftSource {
  kind: SourceKind;
  label: string;
  url: string;
}

interface Props {
  mode: "create" | "edit";
  viewer: SessionUser;
  /** 어느 메뉴에서 들어왔는지 — initial 이 없을 때의 기본 카테고리 */
  initialSection: WritableSection;
  /** 이어쓸 임시저장 글(create) 또는 수정 대상 글(edit) */
  initial: ArticleFull | null;
  /** 발표 자료로 이미 붙어 있는 첨부 (심층 분석 수정 시) */
  attachedFileName: string | null;
}

const BLOCK_LABEL: Record<BlockType, string> = {
  text: "본문",
  head: "소제목",
  quote: "인용",
  table: "표",
};

const BLOCK_STYLE: Record<BlockType, { bg: string; fg: string }> = {
  text: { bg: "var(--gray-100)", fg: "var(--gray-700)" },
  head: { bg: "var(--purple-50)", fg: "var(--purple-700)" },
  quote: { bg: "var(--yellow-50)", fg: "var(--yellow-800)" },
  table: { bg: "var(--blue-50)", fg: "var(--blue-700)" },
};

/**
 * 블록 추가 버튼의 목록. BLOCK_LABEL 에서 뽑는다.
 *
 * 예전에는 `["text","head","quote"] as BlockType[]` 이라고 적어 두었는데, 그건
 * 배열이 아니라 캐스트라서 BlockType 에 종류를 더해도 컴파일 에러가 나지 않고
 * 버튼만 조용히 안 생겼다. BLOCK_LABEL 은 Record<BlockType,…> 이라 빠뜨리면
 * 컴파일이 깨지므로, 여기서 파생시켜 알림 지점을 한곳으로 모은다.
 */
const BLOCK_TYPES = Object.keys(BLOCK_LABEL) as BlockType[];

/** 서식 선택 버튼. 값은 전부 열거형이라 style 로 흘러 들어가지 않는다. */
const ALIGNS: { v: BlockAlign; label: string }[] = [
  { v: "left", label: "왼쪽" },
  { v: "center", label: "가운데" },
  { v: "right", label: "오른쪽" },
];

const SIZES: { v: BlockSize; label: string }[] = [
  { v: "sm", label: "작게" },
  { v: "md", label: "보통" },
  { v: "lg", label: "크게" },
];

const COLORS: { v: BlockColor; label: string; swatch: string }[] = [
  { v: "default", label: "기본", swatch: "var(--gray-800)" },
  { v: "purple", label: "보라", swatch: "var(--purple-700)" },
  { v: "blue", label: "파랑", swatch: "var(--blue-700)" },
  { v: "green", label: "초록", swatch: "var(--green-700)" },
  { v: "red", label: "빨강", swatch: "var(--red-700)" },
  { v: "yellow", label: "노랑", swatch: "var(--yellow-700)" },
  { v: "gray", label: "회색", swatch: "var(--gray-500)" },
];

/** 새 표의 초기 모양 — 머리행 + 본문 한 행. */
function emptyTable(): string[][] {
  return [
    ["", ""],
    ["", ""],
  ];
}

const SOURCE_CYCLE: SourceKind[] = ["gh", "hn", "ax", "gk"];

/** 입력이 멈추고 이만큼 지나면 임시 저장한다. */
const AUTOSAVE_MS = 3000;

/** ISO 문자열 -> input[type=datetime-local] 이 받는 로컬 시간 문자열 */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function agoLabel(d: Date): string {
  const sec = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (sec < 10) return "방금";
  if (sec < 60) return `${sec}초 전`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}분 전`;
  return `${Math.round(min / 60)}시간 전`;
}

/**
 * 위클리 리뷰 / 심층 분석 글 편집기.
 *
 * 임시저장은 브라우저가 아니라 articles(status='draft') 행으로 남는다. 그래야
 * 다른 기기에서도 이어쓸 수 있고 "본인 계정으로 임시저장" 이 성립한다.
 * 저장 응답의 id 를 되돌려 받아 두 번째 저장부터는 같은 행을 UPDATE 한다.
 */
export default function ArticleComposer({
  mode,
  viewer,
  initialSection,
  initial,
  attachedFileName,
}: Props) {
  const router = useRouter();

  /** 이미 발행된 글을 고치는 중인가 — 이때는 자동 저장하지 않는다. */
  const isPublished = initial?.status === "published";

  const [articleId, setArticleId] = useState<string | null>(initial?.id ?? null);
  const [section, setSection] = useState<WritableSection>(
    initial?.section ?? initialSection,
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [deck, setDeck] = useState(initial?.deck ?? "");
  const [tags, setTags] = useState(initial?.tags.join(", ") ?? "");
  const [repoLabel, setRepoLabel] = useState(initial?.repo_label ?? "");
  const [talkDate, setTalkDate] = useState(toLocalInput(initial?.talk_date ?? null));
  const [talkRoom, setTalkRoom] = useState(initial?.talk_room ?? "");

  const [blocks, setBlocks] = useState<Block[]>(
    initial?.body.length ? initial.body : [{ type: "text", t: "" }],
  );
  const [sources, setSources] = useState<DraftSource[]>(
    initial?.sources.length
      ? initial.sources.map((x) => ({ kind: x.kind, label: x.label ?? "", url: x.url }))
      : [{ kind: "gh", label: "", url: "" }],
  );

  const [busy, setBusy] = useState<null | "draft" | "publish" | "delete">(null);
  const [autosaving, setAutosaving] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // 발표 자료 업로드
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [profileIdx, setProfileIdx] = useState(1);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [uploading, setUploading] = useState(false);
  const [attachmentId, setAttachmentId] = useState<string | null>(null);

  const isDeep = section === "deep";
  const charCount = blocks.reduce((n, b) => n + blockPlainText(b).length, 0);
  const tagList = useMemo(
    () => tags.split(",").map((t) => t.trim()).filter(Boolean),
    [tags],
  );
  const filledBlocks = blocks.filter(blockHasContent);
  const filledSources = sources.filter((x) => x.url.trim());

  /**
   * 표시용 작성자 이름. 고를 수 없고 저장 페이로드에도 넣지 않는다 — 서버가
   * 신규 생성에서 세션의 본인으로 찍고, 수정에서는 author_id 를 건드리지 않는다.
   *
   * 수정 화면에서는 원 작성자를 보여 준다. 관리자가 남의 글을 열었을 때 자기
   * 이름이 보이면 저장하면 작성자가 바뀐다고 오해하게 된다 (바뀌지 않는다).
   */
  const authorName = initial?.author?.name ?? viewer.name;

  /** 이미 붙어 있는 발표 자료가 있으면 재업로드를 강요하지 않는다. */
  const hasDeckFile = attachmentId !== null || attachedFileName !== null;

  const checklist = [
    { ok: title.trim().length > 0, t: "제목을 입력했습니다" },
    { ok: deck.trim().length > 0, t: "부제로 결론을 요약했습니다" },
    { ok: filledBlocks.length >= 2, t: "본문 블록이 2개 이상입니다" },
    { ok: filledSources.length > 0, t: "원문 링크를 1건 이상 넣었습니다" },
    ...(isDeep
      ? [
          { ok: talkDate.trim().length > 0, t: "발표 일시를 입력했습니다" },
          { ok: hasDeckFile, t: "발표 자료를 업로드했습니다" },
        ]
      : []),
  ];
  const canPublish = checklist.every((c) => c.ok);

  // --- 블록 조작 -----------------------------------------------------------

  /**
   * 표는 rows 를 미리 채워서 만든다. rows 없이 만들면 셀 격자가 그려지지 않고,
   * blockHasContent 기준으로도 빈 블록이라 자동 저장에서 그대로 사라진다.
   */
  const addBlock = (type: BlockType) =>
    setBlocks((b) => [
      ...b,
      type === "table" ? { type, t: "", rows: emptyTable() } : { type, t: "" },
    ]);

  const setBlockText = (i: number, t: string) =>
    setBlocks((b) => b.map((x, j) => (j === i ? { ...x, t } : x)));

  /**
   * 서식 속성 변경. 같은 값을 다시 누르면 속성을 지워 기본값으로 돌린다.
   * 그래야 "기본값" 상태를 표현할 수 있고, 필드가 없는 기존 글과 모양이 같아진다.
   */
  const toggleBlockAttr = <K extends "align" | "size" | "color">(
    i: number,
    key: K,
    value: NonNullable<Block[K]>,
  ) =>
    setBlocks((b) =>
      b.map((x, j) => {
        if (j !== i) return x;
        const next = { ...x };
        if (next[key] === value) delete next[key];
        else next[key] = value;
        return next;
      }),
    );

  /**
   * 표 조작. 전부 rows 를 새 배열로 복제해서 돌려준다.
   *
   * 제자리에서 고치면 snapshot memo 의 의존성 배열이 같은 참조를 보고 넘어가
   * 자동 저장이 아예 돌지 않는다 (변경 감지가 blocks 참조 기준이다).
   */
  const cloneRows = (x: Block) => (x.rows ?? emptyTable()).map((r) => [...r]);

  const withRows = (i: number, fn: (rows: string[][]) => string[][]) =>
    setBlocks((b) =>
      b.map((x, j) => (j === i ? { ...x, rows: fn(cloneRows(x)) } : x)),
    );

  const setCell = (i: number, r: number, c: number, v: string) =>
    withRows(i, (rows) => {
      if (rows[r]) rows[r][c] = v;
      return rows;
    });

  const addRow = (i: number) =>
    withRows(i, (rows) =>
      rows.length >= TABLE_MAX_ROWS
        ? rows
        : [...rows, Array.from({ length: rows[0]?.length ?? 2 }, () => "")],
    );

  const delRow = (i: number) =>
    // 머리행은 남긴다 — 머리행이 없으면 표가 아니다.
    withRows(i, (rows) => (rows.length <= 1 ? rows : rows.slice(0, -1)));

  const addCol = (i: number) =>
    withRows(i, (rows) =>
      (rows[0]?.length ?? 0) >= TABLE_MAX_COLS ? rows : rows.map((r) => [...r, ""]),
    );

  const delCol = (i: number) =>
    withRows(i, (rows) =>
      (rows[0]?.length ?? 0) <= 1 ? rows : rows.map((r) => r.slice(0, -1)),
    );

  const moveBlock = (i: number, dir: -1 | 1) =>
    setBlocks((b) => {
      const j = i + dir;
      if (j < 0 || j >= b.length) return b;
      const next = [...b];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  /**
   * 마지막 하나는 지우는 대신 빈 본문 블록으로 되돌린다. 예전에는 삭제를 그냥
   * 막아서, 블록이 표 하나뿐이면 표를 빼낼 방법이 없었다.
   */
  const delBlock = (i: number) =>
    setBlocks((b) =>
      b.length === 1 ? [{ type: "text", t: "" }] : b.filter((_, j) => j !== i),
    );

  // --- 소스 조작 -----------------------------------------------------------
  const cycleKind = (i: number) =>
    setSources((xs) =>
      xs.map((x, j) =>
        j === i
          ? {
              ...x,
              kind: SOURCE_CYCLE[(SOURCE_CYCLE.indexOf(x.kind) + 1) % SOURCE_CYCLE.length],
            }
          : x,
      ),
    );
  const setSourceUrl = (i: number, url: string) =>
    setSources((xs) => xs.map((x, j) => (j === i ? { ...x, url } : x)));
  const delSource = (i: number) => setSources((xs) => xs.filter((_, j) => j !== i));

  // --- 변경 추적 -----------------------------------------------------------

  /** 저장 대상 전체를 한 문자열로. 변경 감지와 "저장 후에도 그대로인가" 비교용. */
  const snapshot = useMemo(
    () =>
      JSON.stringify({
        section,
        title,
        deck,
        tags,
        repoLabel,
        talkDate,
        talkRoom,
        blocks,
        sources,
        attachmentId,
      }),
    [
      section,
      title,
      deck,
      tags,
      repoLabel,
      talkDate,
      talkRoom,
      blocks,
      sources,
      attachmentId,
    ],
  );

  /** 마지막으로 저장된(또는 불러온) 상태. 이것과 같으면 저장할 게 없다. */
  const baseline = useRef(snapshot);

  /** 저장이 끝난 시점의 최신 입력과 비교하기 위한 거울. */
  const snapshotRef = useRef(snapshot);

  /** 초기화 직후 한 번은 baseline 을 새로 잡아 "변경됨" 으로 오인하지 않게 한다. */
  const rebaseline = useRef(false);

  /**
   * 저장 요청이 큐에서 실행될 때의 현재 글 id.
   * state 는 비동기라 두 저장이 겹치면 둘 다 null 을 보고 두 행을 만든다.
   * 저장·초기화가 직접 갱신하므로 렌더 중에 맞출 필요가 없다.
   */
  const articleIdRef = useRef(articleId);

  useEffect(() => {
    if (rebaseline.current) {
      rebaseline.current = false;
      baseline.current = snapshot;
      setDirty(false);
      return;
    }
    setDirty(snapshot !== baseline.current);
  }, [snapshot]);

  // 저장하지 않은 변경이 있으면 이탈 시 경고
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // "n분 전 저장됨" 표시를 주기적으로 갱신
  const [, tick] = useState(0);
  useEffect(() => {
    if (!savedAt) return;
    const id = setInterval(() => tick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, [savedAt]);

  // --- 저장 ----------------------------------------------------------------

  /**
   * 저장·삭제 요청을 한 줄로 세운다.
   *
   * 자동 저장과 수동 저장이 겹치면 둘 다 articleId 가 아직 null 인 채로 나가
   * 같은 글이 두 행으로 INSERT 된다. 앞 요청이 끝나 id 를 받은 뒤에 다음을 보낸다.
   * 초기화의 DELETE 도 같은 큐에 태워, 진행 중인 저장이 만든 행을 확실히 지운다.
   */
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = chain.current.then(fn, fn);
    chain.current = next.catch(() => undefined);
    return next;
  }

  /** 세션이 끊기면 라우트가 /login 으로 307 되어 JSON 이 아닌 응답이 온다. */
  async function readJson(res: Response): Promise<{ id?: string; error?: string }> {
    const ct = res.headers.get("content-type") ?? "";
    if (res.redirected || !ct.includes("application/json")) {
      throw new Error("로그인이 만료되었습니다. 새 탭에서 다시 로그인한 뒤 저장해 주세요.");
    }
    return (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  }

  async function save(
    status: "draft" | "published",
    opts: { auto?: boolean } = {},
  ): Promise<string | null> {
    if (!title.trim()) return null;

    const sent = snapshot;

    return enqueue(async () => {
      if (opts.auto) setAutosaving(true);
      else {
        setBusy(status === "draft" ? "draft" : "publish");
        setNotice(null);
      }
      setError(null);

      try {
        const res = await fetch("/api/articles", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: articleIdRef.current ?? undefined,
            section,
            title: title.trim(),
            deck: deck.trim() || null,
            body: filledBlocks,
            tags: tagList,
            repoLabel: repoLabel.trim() || null,
            status,
            talkDate: isDeep && talkDate ? new Date(talkDate).toISOString() : null,
            talkRoom: isDeep ? talkRoom.trim() || null : null,
            attachmentId,
            sources: filledSources.map((x) => ({
              kind: x.kind,
              label: x.label.trim() || null,
              url: x.url.trim(),
            })),
          }),
        });

        const j = await readJson(res);
        if (!res.ok || !j.id) throw new Error(j.error ?? "저장에 실패했습니다.");

        articleIdRef.current = j.id;
        setArticleId(j.id);
        setSavedAt(new Date());

        // 저장하는 동안 더 입력했다면 아직 미저장 상태다.
        if (sent === snapshotRef.current) {
          baseline.current = sent;
          setDirty(false);
        }
        return j.id;
      } catch (e) {
        setError(e instanceof Error ? e.message : "저장에 실패했습니다.");
        return null;
      } finally {
        if (opts.auto) setAutosaving(false);
        else setBusy(null);
      }
    });
  }

  /** 최신 save 를 참조로 들고 있어야 자동 저장 타이머가 매 렌더 초기화되지 않는다. */
  const saveRef = useRef(save);

  // 렌더 중에는 ref 를 건드리지 않는다 (react-hooks/refs). 커밋 뒤에 맞춘다.
  useEffect(() => {
    snapshotRef.current = snapshot;
    saveRef.current = save;
  });

  useEffect(() => {
    // 발행된 글을 고치는 중에는 자동 저장하지 않는다 — 반쯤 고친 내용이 그대로 공개된다.
    if (isPublished) return;
    // 화면을 열기만 한 상태에서는 저장하지 않는다 (빈 행이 생긴다).
    if (snapshot === baseline.current) return;
    if (!title.trim()) return;

    const id = setTimeout(
      () => void saveRef.current("draft", { auto: true }),
      AUTOSAVE_MS,
    );
    return () => clearTimeout(id);
  }, [snapshot, isPublished, title]);

  async function publish() {
    const id = await save("published");
    if (!id) return;
    baseline.current = snapshotRef.current;
    setDirty(false);
    router.push(routes.article({ id }));
  }

  async function requestDelete(id: string): Promise<void> {
    const res = await fetch(`/api/articles/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const j = await readJson(res).catch((e: Error) => ({ error: e.message }));
      throw new Error(j.error ?? "삭제에 실패했습니다.");
    }
  }

  /** 임시저장을 버리고 빈 화면에서 다시 시작한다. */
  async function reset() {
    if (busy) return;
    const hasSaved = articleIdRef.current !== null;
    const msg = hasSaved
      ? "임시저장된 글을 삭제하고 처음부터 다시 작성할까요? 되돌릴 수 없습니다."
      : "작성 중인 내용을 모두 지울까요?";
    if (!window.confirm(msg)) return;

    setBusy("delete");
    setError(null);
    setNotice(null);

    // 진행 중인 저장이 끝난 뒤에 지워야, 그 저장이 만든 행이 남지 않는다.
    await enqueue(async () => {
      try {
        const id = articleIdRef.current;
        if (id) await requestDelete(id);

        articleIdRef.current = null;
        rebaseline.current = true;

        setArticleId(null);
        setSection(initialSection);
        setTitle("");
        setDeck("");
        setTags("");
        setRepoLabel("");
        setTalkDate("");
        setTalkRoom("");
        setBlocks([{ type: "text", t: "" }]);
        setSources([{ kind: "gh", label: "", url: "" }]);
        setFile(null);
        setProgress(null);
        setAttachmentId(null);
        setSavedAt(null);
        setNotice("처음부터 새로 작성합니다.");
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "초기화에 실패했습니다.");
      } finally {
        setBusy(null);
      }
    });
  }

  async function destroy() {
    if (busy) return;
    if (!window.confirm("이 글을 삭제할까요? 코멘트와 발표 자료도 함께 지워집니다.")) {
      return;
    }
    setBusy("delete");
    setError(null);

    await enqueue(async () => {
      try {
        const id = articleIdRef.current;
        if (id) await requestDelete(id);
        setDirty(false);
        router.push(routes.section(section));
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "삭제에 실패했습니다.");
        setBusy(null);
      }
    });
  }

  // --- 업로드 --------------------------------------------------------------
  async function runUpload() {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const id = await startChunkedUpload({
        file,
        throttleMs: SPEED_PROFILES[profileIdx].throttleMs,
        onProgress: setProgress,
      });
      setAttachmentId(id);
      setNotice(`발표 자료 업로드 완료 · ${file.name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드에 실패했습니다.");
    } finally {
      setUploading(false);
    }
  }

  const chunkCount = file ? Math.ceil(file.size / (4 * 1024 * 1024)) : 0;
  const activeStageIdx = progress
    ? Math.min(4, Math.floor((progress.overallPct / 100) * 5))
    : -1;

  const saveState = autosaving
    ? "자동 저장 중…"
    : dirty
      ? "저장하지 않은 변경"
      : savedAt
        ? `${agoLabel(savedAt)} 저장됨`
        : null;

  return (
    <div className={s.wrap}>
      <div className={s.head}>
        <Link href={routes.section(section)} className={s.back}>
          ← {SECTION_MAP[section].ko}
        </Link>
        <div>
          <div className={s.title}>
            {isPublished ? "글 수정" : "글 쓰기"} · {SECTION_MAP[section].ko}
          </div>
          <div className={s.sub}>
            본문 {charCount}자 · 블록 {filledBlocks.length}개
            {saveState && (
              <>
                {" · "}
                <span
                  className={`${s.autosaveNote} ${autosaving ? s.autosaveNoteBusy : ""}`}
                >
                  {saveState}
                </span>
              </>
            )}
          </div>
        </div>
        <div className={s.headActions}>
          {isPublished ? (
            <>
              <button
                type="button"
                className={s.dangerBtn}
                onClick={() => void destroy()}
                disabled={busy !== null}
              >
                {busy === "delete" ? "삭제 중…" : "삭제"}
              </button>
              <button
                type="button"
                className={s.publishBtn}
                onClick={() => void publish()}
                disabled={busy !== null || !canPublish}
                title={canPublish ? "" : "확인 항목을 모두 채워 주세요"}
              >
                {busy === "publish" ? "저장 중…" : "수정 저장"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={s.ghostBtn}
                onClick={() => void reset()}
                disabled={busy !== null}
              >
                {busy === "delete" ? "초기화 중…" : "초기화"}
              </button>
              <button
                type="button"
                className={s.saveBtn}
                onClick={() => void save("draft")}
                disabled={busy !== null || !title.trim()}
              >
                {busy === "draft" ? "저장 중…" : "임시 저장"}
              </button>
              <button
                type="button"
                className={s.publishBtn}
                onClick={() => void publish()}
                disabled={busy !== null || !canPublish}
                title={canPublish ? "" : "발행 전 확인 항목을 모두 채워 주세요"}
              >
                {busy === "publish" ? "발행 중…" : "발행하기"}
              </button>
            </>
          )}
        </div>
      </div>

      {mode === "create" && initial && (
        <div className={s.resumeNote}>
          이전에 임시저장한 내용을 불러왔습니다. 처음부터 쓰려면 <strong>초기화</strong>를
          누르세요.
        </div>
      )}

      <div className={s.grid}>
        {/* ---------------- 에디터 ---------------- */}
        <div className={s.editor}>
          <div className={s.sectionBar}>
            <span className={s.sectionLabel}>카테고리</span>
            {(["review", "deep"] as WritableSection[]).map((k) => (
              <button
                key={k}
                type="button"
                className={`${s.sectionChip} ${section === k ? s.sectionChipOn : ""}`}
                onClick={() => setSection(k)}
                disabled={isPublished}
              >
                {SECTION_MAP[k].ko}
                <span className={s.sectionChipNote}>
                  {k === "review" ? "주 1회" : "월 1회"}
                </span>
              </button>
            ))}
            <span className={s.sectionHint}>
              {isPublished
                ? "발행된 글의 카테고리는 바꿀 수 없습니다"
                : "긱뉴스 · 트렌드 브리핑은 자동 수집 카테고리입니다"}
            </span>
          </div>

          <div className={s.metaBlock}>
            <input
              className={s.titleInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="제목을 입력하세요"
            />
            <textarea
              className={s.deckInput}
              rows={2}
              value={deck}
              onChange={(e) => setDeck(e.target.value)}
              placeholder="부제 · 결론을 한두 문장으로"
            />
            <div className={s.twoCol}>
              <div>
                <div className={s.fieldLabel}>작성자</div>
                <input className={s.textInput} value={authorName} readOnly disabled />
                <div className={s.fieldHint}>
                  {mode === "edit"
                    ? "작성자는 바뀌지 않습니다"
                    : "본인 이름으로만 등록됩니다"}
                </div>
              </div>
              <div>
                <div className={s.fieldLabel}>태그 · 쉼표로 구분</div>
                <input
                  className={s.textInput}
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="graph-rag, 사내적용"
                />
              </div>
            </div>
            {!isDeep && (
              <div>
                <div className={s.fieldLabel}>저장소 · 출처 라벨 (카드에 표시)</div>
                <input
                  className={s.textInput}
                  value={repoLabel}
                  onChange={(e) => setRepoLabel(e.target.value)}
                  placeholder="github.com/vllm-project/vllm"
                />
              </div>
            )}
          </div>

          {/* -------- 발표 정보 (심층 분석 전용) -------- */}
          {isDeep && (
            <div className={s.talkBlock}>
              <div className={s.talkTitle}>발표 정보</div>
              <div className={s.talkGrid}>
                <div>
                  <div className={s.fieldLabel}>발표 일시</div>
                  <input
                    className={s.textInput}
                    type="datetime-local"
                    value={talkDate}
                    onChange={(e) => setTalkDate(e.target.value)}
                  />
                </div>
                <div>
                  <div className={s.fieldLabel}>장소</div>
                  <input
                    className={s.textInput}
                    value={talkRoom}
                    onChange={(e) => setTalkRoom(e.target.value)}
                    placeholder="판교 A동 회의실 4"
                  />
                </div>
              </div>

              <div className={s.uploadGrid}>
                <div className={s.photoBox} />
                <div className={s.dropZone}>
                  <div className={s.fileRow}>
                    <div className={s.pdfIcon}>
                      {file?.name.split(".").pop()?.toUpperCase().slice(0, 3) ?? "PDF"}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div className={s.fileName}>
                        {file?.name ?? attachedFileName ?? "발표 자료를 선택하세요"}
                      </div>
                      <div className={s.fileMeta}>
                        {file
                          ? `${mb(file.size)} · 1회 전송 한도 10MB 초과 → ${chunkCount}조각 분할`
                          : attachedFileName
                            ? "이미 등록된 자료입니다 · 새 파일을 고르면 교체됩니다"
                            : "PDF · PPTX 등 · 10MB 초과 시 자동 분할 암호화 전송"}
                      </div>
                    </div>
                  </div>

                  <input
                    ref={fileRef}
                    type="file"
                    className={s.hiddenInput}
                    onChange={(e) => {
                      setFile(e.target.files?.[0] ?? null);
                      setProgress(null);
                      setAttachmentId(null);
                    }}
                  />

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className={s.blockTool}
                      onClick={() => fileRef.current?.click()}
                    >
                      파일 선택
                    </button>
                    {SPEED_PROFILES.map((p, i) => (
                      <button
                        key={p.label}
                        type="button"
                        className={`${s.blockTool} ${
                          profileIdx === i ? s.sectionChipOn : ""
                        }`}
                        onClick={() => setProfileIdx(i)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    className={s.uploadBtn}
                    onClick={() => void runUpload()}
                    disabled={!file || uploading || attachmentId !== null}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M12 19V5" />
                      <path d="m5 12 7-7 7 7" />
                    </svg>
                    {attachmentId
                      ? "업로드 완료"
                      : uploading
                        ? `전송 중 ${progress?.overallPct ?? 0}%`
                        : "분할 암호화 업로드 시작"}
                  </button>

                  {progress && (
                    <div style={{ marginTop: 12 }}>
                      <div
                        style={{
                          height: 8,
                          background: "var(--gray-100)",
                          borderRadius: "var(--radius-full)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${progress.overallPct}%`,
                            background: "var(--purple-600)",
                            transition: "width var(--duration-medium) var(--ease-standard)",
                          }}
                        />
                      </div>
                      <div
                        style={{
                          marginTop: 8,
                          display: "flex",
                          gap: 10,
                          flexWrap: "wrap",
                          fontSize: 11,
                          color: "var(--gray-500)",
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        {STAGE_STEP_LABELS.map((label, i) => (
                          <span
                            key={label}
                            style={{
                              color:
                                i <= activeStageIdx
                                  ? "var(--purple-700)"
                                  : "var(--gray-400)",
                              fontWeight: i <= activeStageIdx ? 600 : 400,
                            }}
                          >
                            {i + 1}. {label}
                          </span>
                        ))}
                      </div>
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 11.5,
                          color: "var(--gray-600)",
                        }}
                      >
                        {mb(progress.transferredBytes)} / {file ? mb(file.size) : "-"} 전송
                        · 조각 {progress.chunks.filter((c) => c.pct >= 100).length}/
                        {progress.chunks.length}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* -------- 블록 편집 -------- */}
          <div className={s.blockBar}>
            <span className={s.blockBarLabel}>블록 추가</span>
            {BLOCK_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={s.blockTool}
                onClick={() => addBlock(t)}
              >
                {BLOCK_LABEL[t]}
              </button>
            ))}
            <span className={s.blockBarHint}>↑ ↓ 로 순서 변경</span>
          </div>

          <div className={s.blockList}>
            {blocks.map((b, i) => {
              /*
               * BLOCK_STYLE[b.type] 을 그대로 인덱싱하면, 지금 번들이 모르는
               * 종류가 담긴 글을 열었을 때(배포 스큐 — 새 번들이 저장한 표를
               * 캐시된 옛 번들이 여는 경우) undefined.bg 로 편집 화면이 통째로
               * 죽는다. 지면 렌더러는 기본 분기로 흘러가 살아남는데 여기만
               * 크래시하므로 폴백을 둔다.
               */
              const badge = BLOCK_STYLE[b.type] ?? BLOCK_STYLE.text;
              const isTable = b.type === "table";

              return (
              <div key={i} className={s.block}>
                <span
                  className={s.blockBadge}
                  style={{ background: badge.bg, color: badge.fg }}
                >
                  {BLOCK_LABEL[b.type] ?? BLOCK_LABEL.text}
                </span>

                <div className={s.blockMain}>
                  {/* -------- 서식 툴바 -------- */}
                  <div className={s.fmtBar}>
                    <span className={s.fmtLabel}>정렬</span>
                    {ALIGNS.map((a) => (
                      <button
                        key={a.v}
                        type="button"
                        className={`${s.fmtBtn} ${
                          (b.align ?? "left") === a.v ? s.fmtBtnOn : ""
                        }`}
                        onClick={() => toggleBlockAttr(i, "align", a.v)}
                      >
                        {a.label}
                      </button>
                    ))}

                    {!isTable && (
                      <>
                        <span className={s.fmtDivider} />
                        <span className={s.fmtLabel}>크기</span>
                        {SIZES.map((z) => (
                          <button
                            key={z.v}
                            type="button"
                            className={`${s.fmtBtn} ${
                              (b.size ?? "md") === z.v ? s.fmtBtnOn : ""
                            }`}
                            onClick={() => toggleBlockAttr(i, "size", z.v)}
                          >
                            {z.label}
                          </button>
                        ))}

                        <span className={s.fmtDivider} />
                        <span className={s.fmtLabel}>색상</span>
                        {COLORS.map((c) => (
                          <button
                            key={c.v}
                            type="button"
                            title={c.label}
                            aria-label={`글자 색 ${c.label}`}
                            aria-pressed={(b.color ?? "default") === c.v}
                            className={`${s.swatch} ${
                              (b.color ?? "default") === c.v ? s.swatchOn : ""
                            }`}
                            style={{ background: c.swatch }}
                            onClick={() => toggleBlockAttr(i, "color", c.v)}
                          />
                        ))}
                      </>
                    )}
                  </div>

                  {/* -------- 내용 -------- */}
                  {isTable ? (
                    <div className={s.tableEditor}>
                      <div className={s.tableGridScroll}>
                        <table className={s.tableGrid}>
                          <tbody>
                            {(b.rows ?? []).map((row, r) => (
                              <tr key={r}>
                                {row.map((cell, c) => (
                                  <td key={c}>
                                    <input
                                      className={`${s.cellInput} ${
                                        r === 0 ? s.cellHead : ""
                                      }`}
                                      value={cell}
                                      onChange={(e) => setCell(i, r, c, e.target.value)}
                                      placeholder={r === 0 ? `머리글 ${c + 1}` : ""}
                                    />
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className={s.tableTools}>
                        <span className={s.fmtLabel}>첫 행이 머리글입니다</span>
                        <button type="button" className={s.fmtBtn} onClick={() => addRow(i)}>
                          ＋ 행
                        </button>
                        <button type="button" className={s.fmtBtn} onClick={() => delRow(i)}>
                          － 행
                        </button>
                        <button type="button" className={s.fmtBtn} onClick={() => addCol(i)}>
                          ＋ 열
                        </button>
                        <button type="button" className={s.fmtBtn} onClick={() => delCol(i)}>
                          － 열
                        </button>
                      </div>
                      <input
                        className={s.textInput}
                        value={b.t}
                        onChange={(e) => setBlockText(i, e.target.value)}
                        placeholder="표 설명 · 선택"
                      />
                    </div>
                  ) : (
                    <textarea
                      className={s.blockInput}
                      rows={b.type === "text" ? 4 : 2}
                      value={b.t}
                      onChange={(e) => setBlockText(i, e.target.value)}
                      placeholder="내용을 입력하세요"
                    />
                  )}
                </div>

                <div className={s.blockActions}>
                  <button
                    type="button"
                    className={s.iconSm}
                    onClick={() => moveBlock(i, -1)}
                    aria-label="위로"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className={s.iconSm}
                    onClick={() => moveBlock(i, 1)}
                    aria-label="아래로"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={`${s.iconSm} ${s.iconDel}`}
                    onClick={() => delBlock(i)}
                    aria-label="삭제"
                  >
                    ✕
                  </button>
                </div>
              </div>
              );
            })}
          </div>

          {/* -------- 원문 소스 -------- */}
          <div className={s.sourceBlock}>
            <div className={s.sourceHead}>
              <span className={s.sourceTitle}>원문 소스</span>
              <span className={s.sourceHint}>
                배지를 눌러 GITHUB · HN · ARXIV · GEEKNEWS 를 전환합니다
              </span>
              <button
                type="button"
                className={s.addSourceBtn}
                onClick={() =>
                  setSources((xs) => [...xs, { kind: "gh", label: "", url: "" }])
                }
              >
                ＋ 링크 추가
              </button>
            </div>
            <div className={s.sourceList}>
              {sources.map((x, i) => {
                const style = SRC[x.kind];
                return (
                  <div key={i} className={s.sourceRow}>
                    <button
                      type="button"
                      className={s.sourceKind}
                      style={{ background: style.bg, color: style.fg }}
                      onClick={() => cycleKind(i)}
                    >
                      {style.tag}
                    </button>
                    <input
                      className={s.sourceUrl}
                      value={x.url}
                      onChange={(e) => setSourceUrl(i, e.target.value)}
                      placeholder="https://"
                    />
                    <button
                      type="button"
                      className={s.sourceDel}
                      onClick={() => delSource(i)}
                      aria-label="삭제"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ---------------- 사이드 ---------------- */}
        <aside className={s.aside}>
          <div className={s.previewCard}>
            <div className={s.previewHead}>
              <span className={s.previewTitle}>지면 미리보기</span>
              <span className={s.previewNote}>실제 발행 화면</span>
            </div>
            <div className={s.previewBody}>
              <div className={s.pvKicker}>{isDeep ? "심층 분석" : "위클리 리뷰"}</div>
              <div className={s.pvTitle}>{title || "제목을 입력하세요"}</div>
              {deck && <div className={s.pvDeck}>{deck}</div>}
              <div className={s.pvByline}>
                {authorName} · {dotDate(new Date())}
              </div>
              <div className={s.pvBlocks}>
                {filledBlocks.length === 0 ? (
                  <div className={s.pvEmpty}>본문을 입력하면 여기에 나타납니다</div>
                ) : (
                  filledBlocks.map((b, i) => {
                    /*
                     * 이 창은 "실제 발행 화면" 이라고 적혀 있으므로 지면과 같은
                     * 규칙으로 그린다. table 분기는 기본 분기보다 앞에 둔다 —
                     * 뒤에 두면 표가 캡션만 든 문단으로 보인다. 표 마크업 자체는
                     * 지면과 BlockTable 을 공유해서 두 쪽이 갈라지지 않게 한다.
                     */
                    const fmt = formatClass(b);

                    if (b.type === "table")
                      return (
                        <div key={i} className={s.pvTable}>
                          <BlockTable block={b} />
                        </div>
                      );
                    if (b.type === "head")
                      return (
                        <div key={i} className={`${s.pvHead} ${fmt}`}>
                          {b.t}
                        </div>
                      );
                    if (b.type === "quote")
                      return (
                        <div key={i} className={`${s.pvQuote} ${fmt}`}>
                          {b.t}
                        </div>
                      );
                    return (
                      <p key={i} className={`${s.pvText} ${fmt}`}>
                        {b.t}
                      </p>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <div className={s.checklistCard}>
            <div className={s.checklistTitle}>발행 전 확인</div>
            <div className={s.checklist}>
              {checklist.map((c) => (
                <div key={c.t} className={s.checkRow}>
                  <span
                    className={s.checkMark}
                    style={{
                      background: c.ok ? "var(--green-500)" : "var(--gray-200)",
                      color: c.ok ? "#fff" : "var(--gray-500)",
                    }}
                  >
                    {c.ok ? "✓" : ""}
                  </span>
                  <span className={s.checkText}>{c.t}</span>
                </div>
              ))}
            </div>
            <div className={s.checklistNote}>
              발행하면 해당 카테고리 아카이브와 1면에 바로 반영됩니다.
            </div>
          </div>

          {error && <div className={s.errorBox}>{error}</div>}
          {notice && <div className={s.okBox}>{notice}</div>}
        </aside>
      </div>
    </div>
  );
}
