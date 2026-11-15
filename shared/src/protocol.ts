// What the server and the clients say to each other. The server owns every decision;
// clients send intents and draw the RoomView they're given.

import type { Board, BoardSummary } from "./board.js";

export const DEFAULT_GAME_NAME = "Buzz Board";

/** "cohost": runs the game beside the host (a staff take-over or an invite), but can't end the room or remove anyone. */
export type Role = "host" | "cohost" | "table" | "player";

/**
 * lobby     waiting for players
 * board     a round's board is up; someone picks a square
 * clue      one clue is in play (see ClueStage)
 * roundEnd  the round's board is cleared; scores on screen
 * lastCall  the final round (see LastCallStage)
 * final     the winner is on screen
 */
export type Phase = "lobby" | "board" | "clue" | "roundEnd" | "lastCall" | "final";

/**
 * wager      a Double Down square: its picker is choosing a wager (clue still hidden)
 * reading    the clue is up, the host is reading it, buzzers are closed
 * open       buzzers are open and the clock is running
 * answering  someone buzzed in (or it's a Double Down); the host judges
 * revealed   the answer is up; the host moves on
 */
export type ClueStage = "wager" | "reading" | "open" | "answering" | "revealed";

/**
 * wager   the category is up; everyone wagers in secret
 * answer  the clue is up; everyone types an answer before the clock runs out
 * reveal  the host shows and judges the answers one by one
 */
export type LastCallStage = "wager" | "answer" | "reveal";

export interface RoomSettings {
  /** Teams (several phones share a score, any of them can buzz) or everyone for themselves. */
  teams: boolean;
  boardId: string;
  /** Seconds to buzz in once the host opens the buzzers. */
  buzzSeconds: number;
  /** A buzz before the buzzers open locks that phone out for this long. */
  earlyPenaltyMs: number;
  /** A wrong answer takes the clue's points off. */
  wrongCosts: boolean;
  /** The player in control may pick the next square on their phone (the host always can). */
  playersPick: boolean;
  /** Hidden Double Down squares per round. */
  doubleDowns: number;
  /** Rounds after the first are worth double. */
  doubleLater: boolean;
  /** Finish with Last Call when the board has one. */
  lastCall: boolean;
  /** Seconds to type a Last Call answer. */
  lastCallSeconds: number;
}

export const DEFAULT_SETTINGS: RoomSettings = {
  teams: false,
  boardId: "",
  buzzSeconds: 10,
  earlyPenaltyMs: 250,
  wrongCosts: true,
  playersPick: false,
  doubleDowns: 1,
  doubleLater: true,
  lastCall: true,
  lastCallSeconds: 45,
};

export const SETTINGS_LIMITS = {
  buzzSeconds: { min: 3, max: 60 },
  earlyPenaltyMs: { min: 0, max: 2000 },
  doubleDowns: { min: 0, max: 2 },
  lastCallSeconds: { min: 15, max: 180 },
} as const;

/** The least a Double Down can be wagered. */
export const MIN_WAGER = 5;
export const NAME_MAX = 24;
export const LAST_CALL_ANSWER_MAX = 80;

/** Whoever keeps a score: a team, or one player when playing solo. */
export interface ContestantView {
  id: string;
  name: string;
  score: number;
  /** Any of its phones is connected. */
  connected: boolean;
  members: { id: string; name: string; connected: boolean }[];
}

export type Cell = "open" | "used" | "blank";

export interface GridView {
  categories: string[];
  /** Points per row, lowest first. */
  values: number[];
  /** cells[category][row] */
  cells: Cell[][];
}

export interface BuzzView {
  contestantId: string;
  /** The player whose phone buzzed. */
  name: string;
  /** Milliseconds after the buzzers opened, by the server's clock. */
  ms: number;
}

export interface ClueView {
  cat: number;
  row: number;
  category: string;
  value: number;
  doubleDown: boolean;
  stage: ClueStage;
  /** Hidden while a Double Down wager is being chosen. */
  text: string | null;
  /** The host always sees it; everyone else once it's revealed. */
  answer: string | null;
  /** Who is answering. */
  buzzedBy: string | null;
  buzzedName: string | null;
  /** Contestants who answered wrong on this clue. */
  lockedOut: string[];
  /** When the buzz clock runs out (server time). */
  deadline: number | null;
  wager: number | null;
  /** The most the Double Down's picker may wager. */
  wagerMax: number;
  /** Set once revealed: who got it right, or null when nobody did. */
  winnerId: string | null;
  /** The first buzz and the ones just behind it, fastest first. */
  buzzes: BuzzView[];
}

export interface LastCallEntryView {
  contestantId: string;
  wagered: boolean;
  answered: boolean;
  /** Shown to everyone once the host reveals this entry. */
  answer: string | null;
  /** Shown once judged. */
  wager: number | null;
  correct: boolean | null;
}

export interface LastCallView {
  stage: LastCallStage;
  category: string;
  text: string | null;
  /** The host always sees it; everyone else once every entry is judged. */
  answer: string | null;
  deadline: number | null;
  /** In reveal order: lowest score first. */
  entries: LastCallEntryView[];
  /** The entry on screen now. */
  revealing: string | null;
  /** Your own team's entry (players only). */
  mine: { wager: number | null; answer: string; wagerMax: number } | null;
}

export interface RoomView {
  code: string;
  kind: "venue" | "patron" | "private";
  you: {
    id: string;
    role: Role;
    name: string;
    contestantId: string | null;
    /** Your buzzer is locked until then (you buzzed early). Server time. */
    penaltyUntil: number | null;
  };
  phase: Phase;
  serverTime: number;
  settings: RoomSettings;
  boardTitle: string;
  /** 1-based; 0 in the lobby. */
  round: number;
  roundCount: number;
  /** A Last Call follows the last round. */
  hasLastCall: boolean;
  contestants: ContestantView[];
  /** Who is in control of the board (picks the next square). */
  pickerId: string | null;
  grid: GridView | null;
  clue: ClueView | null;
  lastCall: LastCallView | null;
  /** Final: the winner, or several on a tie. */
  winners: string[];
  /** Nobody hosts yet: the next phone to join will. */
  hostOpen: boolean;
  /** Host and co-hosts only: who else runs the game (empty for everyone else). */
  cohosts: { id: string; name: string; connected: boolean }[];
  hostConnected: boolean;
  tableCount: number;
  /** Host only, in the lobby: the boards to choose from. */
  boards: BoardSummary[];
}

export interface JoinResult {
  code: string;
  token: string;
  memberId: string;
  role: Role;
  name: string;
}

export interface RoomInfo {
  teams: boolean;
  teamNames: string[];
  hostOpen: boolean;
  phase: Phase;
}

export type BuzzResult = "first" | "late" | "early" | "penalty" | "locked" | "closed";

// Venue TVs (Bar Games box only).
export interface TvTargets {
  enabled: boolean;
  pinRequired: boolean;
  displays: { id: string; name: string; group?: string; busy?: boolean; showingThisGame?: boolean; roomCode?: string }[];
}
export interface TvCastResult {
  ok: boolean;
  message?: string;
  results?: Record<string, { ok: boolean; message?: string; needsCode?: boolean }>;
}

type Ack<T = object> = (res: ({ ok: true } & T) | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  createRoom: (req: { name?: string }, ack: Ack<JoinResult>) => void;
  roomInfo: (req: { code: string }, ack: Ack<RoomInfo>) => void;
  joinRoom: (
    req: {
      code: string;
      role: "player" | "table";
      name?: string;
      team?: string;
      token?: string;
      /** A co-host invite (?cohost=): single use, expires. */
      cohost?: string;
    },
    ack: Ack<JoinResult>,
  ) => void;
  /** `token`: the seat's own token, or the host link's key (`host: true`, from /join/CODE?host=). */
  resume: (req: { code: string; token: string; host?: boolean }, ack: Ack<JoinResult>) => void;
  leaveRoom: (ack: Ack) => void;
  closeRoom: (ack: Ack) => void;
  // host
  updateSettings: (patch: Partial<RoomSettings>, ack: Ack) => void;
  startGame: (ack: Ack) => void;
  openBuzzers: (ack: Ack) => void;
  judge: (req: { correct: boolean }, ack: Ack) => void;
  skipClue: (ack: Ack) => void;
  cancelClue: (ack: Ack) => void;
  continueGame: (ack: Ack) => void;
  nextRound: (ack: Ack) => void;
  lastCallAdvance: (ack: Ack) => void;
  lastCallJudge: (req: { correct: boolean }, ack: Ack) => void;
  adjustScore: (req: { contestantId: string; delta: number }, ack: Ack) => void;
  setPicker: (req: { contestantId: string }, ack: Ack) => void;
  kickPlayer: (memberId: string, ack: Ack) => void;
  /** Host only: a single-use co-host invite. `path` is under the game's base path. */
  cohostInvite: (ack: Ack<{ path: string; expiresAt: string }>) => void;
  /** Host only: that co-host leaves the room. */
  removeCohost: (memberId: string, ack: Ack) => void;
  playAgain: (ack: Ack) => void;
  listTvs: (ack: Ack<{ tvs: TvTargets }>) => void;
  castToTvs: (req: { ids: string[]; pin?: string }, ack: Ack<{ result: TvCastResult }>) => void;
  stopTvs: (req: { ids: string[]; pin?: string }, ack: Ack<{ result: TvCastResult }>) => void;
  // host, or the player in control
  pickSquare: (req: { cat: number; row: number }, ack: Ack) => void;
  setWager: (req: { amount: number }, ack: Ack) => void;
  // players
  buzz: (ack?: Ack<{ result: BuzzResult }>) => void;
  setTeam: (req: { team: string }, ack: Ack) => void;
  lastCallWager: (req: { amount: number }, ack: Ack) => void;
  lastCallAnswer: (req: { text: string }, ack: Ack) => void;
}

export interface ServerToClientEvents {
  state: (view: RoomView) => void;
  closed: (payload: { reason: string }) => void;
  /** A one-off message for this phone (staff took over hosting). */
  notice: (payload: { message: string }) => void;
}

export const ERRORS = {
  ROOM_NOT_FOUND: "That room doesn't exist. Check the code.",
  ROOM_FULL: "That room is full.",
  NAME_REQUIRED: "Enter your name.",
  NAME_TAKEN: "Someone in the room already has that name.",
  TEAM_REQUIRED: "Pick a team, or name a new one.",
  BAD_TOKEN: "Your seat in that room has expired. Join again.",
  NOT_IN_ROOM: "You're not in a room.",
  NOT_HOST: "Only the host can do that.",
  BAD_HOST_LINK: "That host link has expired. Ask staff for a new one.",
  BAD_INVITE: "That co-host invite has expired or was already used. Ask the host for a new one.",
  NOT_PLAYER: "Only players can do that.",
  NOT_YOUR_PICK: "It isn't your pick.",
  WRONG_PHASE: "That can't be done right now.",
  NEED_PLAYERS: "Nobody has joined yet.",
  NO_BOARD: "Choose a board first.",
  BAD_WAGER: "That wager isn't allowed.",
  BAD_REQUEST: "That request wasn't understood.",
  RATE_LIMITED: "Too many attempts. Try again in a minute.",
  SLOW_LINK: "Your connection can't buzz right now. Reconnecting.",
} as const;

// ---------------------------------------------------------------- admin

export interface AdminSettings {
  roomIdleMinutes: number;
  /** The board new rooms start on ("" = the first one listed). */
  defaultBoardId: string;
}

export const ADMIN_SETTINGS_LIMITS = { roomIdleMinutes: { min: 5, max: 7 * 24 * 60 } } as const;

export interface AdminRoomSummary {
  code: string;
  kind: string;
  createdAt: number;
  lastActivityAt: number;
  phase: Phase;
  round: number;
  boardTitle: string;
  hostConnected: boolean;
  players: number;
  playersConnected: number;
  tables: number;
}

export interface AdminOverview {
  rooms: AdminRoomSummary[];
  settings: AdminSettings;
  boards: BoardSummary[];
  serverTime: number;
}

export type { Board, BoardSummary };
