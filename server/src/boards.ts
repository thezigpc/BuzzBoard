// The venue's boards (DATA_DIR/boards.json, written from the admin) plus the samples
// that ship with the game. Rooms copy a board when a game starts, so editing one never
// changes a game in progress.

import { log, newId } from "@bargames/gamekit/server";
import { SAMPLE_BOARDS, sanitizeBoard, summarize, type Board, type BoardSummary } from "@buzzboard/shared";
import { MAX_BOARDS, store } from "./config.js";

const FILE = "boards.json";
let custom: Board[] = [];

export async function initBoards(): Promise<void> {
  const saved = await store.read<unknown[]>(FILE, (v): v is unknown[] => Array.isArray(v));
  custom = [];
  for (const raw of saved ?? []) {
    try {
      const b = sanitizeBoard(raw);
      if (b.id && !isSample(b.id)) custom.push(b);
    } catch (err) {
      log.warn("boards", "skipped a saved board that isn't valid", { err: String(err) });
    }
  }
}

export const isSample = (id: string): boolean => SAMPLE_BOARDS.some((b) => b.id === id);

/** The venue's own boards first, then the samples. */
export function listBoards(): BoardSummary[] {
  return [...custom.map((b) => summarize(b)), ...SAMPLE_BOARDS.map((b) => summarize(b, true))];
}

export function getBoard(id: string): Board | undefined {
  return custom.find((b) => b.id === id) ?? SAMPLE_BOARDS.find((b) => b.id === id);
}

/** Creates a board (no id), or replaces the venue's own board with that id. Throws a readable Error. */
export async function saveBoard(raw: unknown, id?: string): Promise<Board> {
  const existing = id ? custom.findIndex((b) => b.id === id) : -1;
  if (id && existing < 0) throw new Error(isSample(id) ? "The sample boards can't be changed. Make a copy." : "That board no longer exists.");
  const board = sanitizeBoard(raw, existing >= 0 ? id : newId());
  if (existing >= 0) custom[existing] = board;
  else {
    if (custom.length >= MAX_BOARDS) throw new Error(`There are already ${MAX_BOARDS} boards. Delete one first.`);
    custom.unshift(board);
  }
  await store.write(FILE, custom);
  return board;
}

export async function deleteBoard(id: string): Promise<boolean> {
  const i = custom.findIndex((b) => b.id === id);
  if (i < 0) return false;
  custom.splice(i, 1);
  await store.write(FILE, custom);
  return true;
}
