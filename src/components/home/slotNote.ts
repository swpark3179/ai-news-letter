import { kstDateString, shortDot } from "@/lib/format";
import type { EditionSlot } from "@/lib/data/feed";

/**
 * 1면 칸 머리의 건수 문구. 칸마다 수집한 날이 다를 수 있어(getEdition 주석) 날짜를 붙인다.
 *   오늘 것   「오늘 13건」
 *   지난 것   「09.30 · 13건」
 */
export function slotNote(slot: EditionSlot, today: Date): string {
  if (!slot.date || slot.items.length === 0) return "수집 대기";
  const n = `${slot.items.length}건`;
  return slot.date === kstDateString(today) ? `오늘 ${n}` : `${shortDot(slot.date)} · ${n}`;
}
