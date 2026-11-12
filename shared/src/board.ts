// A board: what the venue's staff write and a room plays. Pure data plus its validator
// and the CSV / JSON import and export. No I/O here, so the server, the admin page and
// the tests all share one set of rules.

export const CLUES_PER_CATEGORY = 5;
export const MIN_CATEGORIES = 2;
export const MAX_CATEGORIES = 6;
export const MAX_ROUNDS = 2;
export const BASE_VALUE = 100;

export const BOARD_LIMITS = { title: 60, category: 40, clue: 300, answer: 120 } as const;

export interface Clue {
  /** What's read out and shown. Empty: this square isn't on the board. */
  clue: string;
  answer: string;
}

export interface Category {
  name: string;
  /** Always CLUES_PER_CATEGORY entries, lowest value first. */
  clues: Clue[];
}

export interface BoardRound {
  categories: Category[];
}

/** The single clue of the final round. */
export interface LastCallClue {
  category: string;
  clue: string;
  answer: string;
}

export interface Board {
  id: string;
  title: string;
  rounds: BoardRound[];
  lastCall: LastCallClue | null;
}

/** What a host's board picker lists. */
export interface BoardSummary {
  id: string;
  title: string;
  rounds: number;
  categories: number;
  clues: number;
  lastCall: boolean;
  /** One of the samples that ship with the game (read-only in the admin). */
  sample: boolean;
}

/** Points for a square: 100 to 500 by row, doubled from the second round on when asked. */
export function valueFor(roundIndex: number, row: number, doubleLater: boolean): number {
  return BASE_VALUE * (row + 1) * (doubleLater && roundIndex > 0 ? 2 : 1);
}

export function summarize(board: Board, sample = false): BoardSummary {
  return {
    id: board.id,
    title: board.title,
    rounds: board.rounds.length,
    categories: board.rounds.reduce((n, r) => n + r.categories.length, 0),
    clues: board.rounds.reduce((n, r) => n + r.categories.reduce((m, c) => m + c.clues.filter((x) => x.clue).length, 0), 0),
    lastCall: board.lastCall !== null,
    sample,
  };
}

/** A new, empty board for the editor. */
export function emptyBoard(id = ""): Board {
  return {
    id,
    title: "",
    rounds: [{ categories: Array.from({ length: 5 }, () => emptyCategory()) }],
    lastCall: null,
  };
}

export function emptyCategory(): Category {
  return { name: "", clues: Array.from({ length: CLUES_PER_CATEGORY }, () => ({ clue: "", answer: "" })) };
}

const text = (v: unknown, max: number): string =>
  typeof v === "string" || typeof v === "number" ? String(v).replace(/\s+/g, " ").trim().slice(0, max) : "";

/**
 * Checks and cleans a board from anywhere (the editor, an imported file, the saved
 * file). Throws an Error a person can act on. Categories with no name and no clues are
 * dropped, so a half-filled editor grid saves cleanly.
 */
export function sanitizeBoard(raw: unknown, id?: string): Board {
  const b = (raw ?? {}) as Partial<Board>;
  const title = text(b.title, BOARD_LIMITS.title);
  if (!title) throw new Error("Give the board a title.");
  if (!Array.isArray(b.rounds) || b.rounds.length === 0) throw new Error("A board needs at least one round.");
  if (b.rounds.length > MAX_ROUNDS) throw new Error(`A board can have at most ${MAX_ROUNDS} rounds.`);

  const rounds: BoardRound[] = b.rounds.map((r, ri) => {
    const where = `Round ${ri + 1}`;
    const cats = Array.isArray(r?.categories) ? r.categories : [];
    const categories: Category[] = [];
    for (const c of cats) {
      const name = text(c?.name, BOARD_LIMITS.category);
      const src = Array.isArray(c?.clues) ? c.clues : [];
      const clues: Clue[] = Array.from({ length: CLUES_PER_CATEGORY }, (_, i) => ({
        clue: text(src[i]?.clue, BOARD_LIMITS.clue),
        answer: text(src[i]?.answer, BOARD_LIMITS.answer),
      }));
      const filled = clues.filter((x) => x.clue || x.answer).length;
      if (!name && filled === 0) continue;
      if (!name) throw new Error(`${where}: a category with clues has no name.`);
      clues.forEach((x, i) => {
        if (x.clue && !x.answer) throw new Error(`${where}, "${name}", row ${i + 1}: the clue has no answer.`);
        if (!x.clue && x.answer) throw new Error(`${where}, "${name}", row ${i + 1}: there's an answer but no clue.`);
      });
      if (filled === 0) throw new Error(`${where}: "${name}" has no clues.`);
      categories.push({ name, clues });
    }
    if (categories.length < MIN_CATEGORIES) throw new Error(`${where} needs at least ${MIN_CATEGORIES} categories.`);
    if (categories.length > MAX_CATEGORIES) throw new Error(`${where} can have at most ${MAX_CATEGORIES} categories.`);
    return { categories };
  });

  let lastCall: LastCallClue | null = null;
  if (b.lastCall) {
    const lc = {
      category: text(b.lastCall.category, BOARD_LIMITS.category),
      clue: text(b.lastCall.clue, BOARD_LIMITS.clue),
      answer: text(b.lastCall.answer, BOARD_LIMITS.answer),
    };
    if (lc.category || lc.clue || lc.answer) {
      if (!lc.category || !lc.clue || !lc.answer) throw new Error("Last Call needs a category, a clue and an answer (or leave all three empty).");
      lastCall = lc;
    }
  }
  return { id: id ?? text(b.id, 64), title, rounds, lastCall };
}

// ------------------------------------------------------------------ CSV

/** RFC 4180-style: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = input.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const csvField = (v: string | number): string => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const CSV_HEADER = ["round", "category", "row", "clue", "answer"] as const;

/**
 * One line per clue: round (1, 2 or "last"), category, row (1 to 5, lowest value first),
 * clue, answer. A first line `title,<the board's title>` names the board.
 */
export function boardToCsv(board: Board): string {
  const lines: (string | number)[][] = [["title", board.title], [...CSV_HEADER]];
  board.rounds.forEach((r, ri) =>
    r.categories.forEach((c) =>
      c.clues.forEach((x, i) => {
        if (x.clue) lines.push([ri + 1, c.name, i + 1, x.clue, x.answer]);
      }),
    ),
  );
  if (board.lastCall) lines.push(["last", board.lastCall.category, "", board.lastCall.clue, board.lastCall.answer]);
  return lines.map((l) => l.map(csvField).join(",")).join("\r\n") + "\r\n";
}

/** Reads the CSV that boardToCsv writes (and spreadsheets saved in that shape). */
export function boardFromCsv(csv: string, fallbackTitle = "Imported board"): Board {
  const rows = parseCsv(csv);
  let title = fallbackTitle;
  const rounds: BoardRound[] = [];
  let lastCall: LastCallClue | null = null;
  rows.forEach((cells, n) => {
    const [first = "", category = "", rowText = "", clue = "", answer = ""] = cells.map((c) => c.trim());
    const key = first.toLowerCase();
    if (key === "title") {
      if (category) title = category;
      return;
    }
    if (key === "round") return; // the header line
    const line = `Line ${n + 1}`;
    if (key === "last" || key === "last call" || key === "final") {
      lastCall = { category, clue, answer };
      return;
    }
    const ri = Number(first) - 1;
    if (!Number.isInteger(ri) || ri < 0 || ri >= MAX_ROUNDS) throw new Error(`${line}: the round must be 1, 2 or "last" (found "${first}").`);
    if (!category) throw new Error(`${line}: the category is missing.`);
    while (rounds.length <= ri) rounds.push({ categories: [] });
    let cat = rounds[ri].categories.find((c) => c.name.toLowerCase() === category.toLowerCase());
    if (!cat) {
      cat = { ...emptyCategory(), name: category };
      rounds[ri].categories.push(cat);
    }
    let i = rowText === "" ? cat.clues.findIndex((x) => !x.clue) : Number(rowText) - 1;
    // Accept the points too (100 to 500, or doubled), for spreadsheets written that way.
    if (i >= CLUES_PER_CATEGORY && (i + 1) % BASE_VALUE === 0) {
      const steps = (i + 1) / BASE_VALUE;
      i = (steps > CLUES_PER_CATEGORY ? steps / 2 : steps) - 1;
    }
    if (!Number.isInteger(i) || i < 0 || i >= CLUES_PER_CATEGORY) throw new Error(`${line}: "${category}" row must be 1 to ${CLUES_PER_CATEGORY} (found "${rowText}").`);
    if (cat.clues[i].clue) throw new Error(`${line}: "${category}" row ${i + 1} is there twice.`);
    cat.clues[i] = { clue, answer };
  });
  return sanitizeBoard({ title, rounds, lastCall }, "");
}

/** A board file's text, JSON or CSV by its content. */
export function boardFromFile(textContent: string, fileName = ""): Board {
  const trimmed = textContent.replace(/^﻿/, "").trim();
  const fallback = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "Imported board";
  if (trimmed.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error("That file isn't valid JSON.");
    }
    const withTitle = { ...(parsed as object), title: (parsed as Board).title || fallback };
    return sanitizeBoard(withTitle, "");
  }
  return boardFromCsv(trimmed, fallback);
}
