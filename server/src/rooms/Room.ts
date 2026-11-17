// One room's game, decided entirely here. Sockets only deliver intents and views.

import {
  CLUES_PER_CATEGORY,
  DEFAULT_SETTINGS,
  LAST_CALL_ANSWER_MAX,
  MIN_WAGER,
  NAME_MAX,
  SETTINGS_LIMITS,
  valueFor,
  type AdminRoomSummary,
  type Board,
  type BuzzResult,
  type BuzzView,
  type Cell,
  type ClueStage,
  type ClueView,
  type LastCallStage,
  type LastCallView,
  type Phase,
  type Role,
  type RoomSettings,
  type RoomView,
} from "@buzzboard/shared";
import {
  cryptoRand,
  HostSeats,
  log,
  newId,
  newToken,
  safeTimeout,
  type CloseCause,
  type KitRoom,
  type RoomOverview,
  type SessionKind,
} from "@bargames/gamekit/server";
import { bg } from "../bargames.js";
import { getBoard, listBoards } from "../boards.js";
import { MAX_PLAYERS_PER_ROOM, MAX_TABLES_PER_ROOM } from "../config.js";
import { GameError } from "./errors.js";

export interface Member {
  id: string;
  token: string;
  role: Role;
  name: string;
  socketIds: Set<string>;
  /** Players: the team (or solo seat) they score for. */
  contestantId: string | null;
  /** Buzzes before this moment are ignored (they buzzed early). Server clock, ms. */
  penaltyUntil: number;
}

/** Whoever keeps a score: a team, or one player when playing solo. */
interface Contestant {
  id: string;
  name: string;
  score: number;
  /** Join order, for stable lists and tie-breaks. */
  seq: number;
}

interface ActiveClue {
  cat: number;
  row: number;
  doubleDown: boolean;
  stage: ClueStage;
  buzzedBy: string | null;
  buzzedName: string | null;
  lockedOut: Set<string>;
  /** When the buzzers last opened (server clock, sub-millisecond). */
  openedAt: number;
  deadline: number | null;
  wager: number | null;
  winnerId: string | null;
  buzzes: BuzzView[];
}

interface LastCallEntry {
  contestantId: string;
  wager: number | null;
  answer: string;
  shown: boolean;
  correct: boolean | null;
}

interface LastCallState {
  stage: LastCallStage;
  deadline: number | null;
  entries: LastCallEntry[];
  revealing: string | null;
}

/** How the room talks to sockets, injected so Room has no socket.io dependency. */
export interface RoomTransport {
  sendState(socketId: string, view: RoomView): void;
  sendClosed(socketId: string, reason: string): void;
  /** A one-off message for one phone (a take-over, or a co-host made a player again). */
  sendNotice(socketId: string, message: string): void;
}

/** The links the host key and co-host invites go in (the box's host_link / cohost_link too). */
export const hostPath = (room: { code: string }, token: string) => `/join/${room.code}?host=${encodeURIComponent(token)}`;
export const cohostPath = (room: { code: string }, token: string) => `/join/${room.code}?cohost=${encodeURIComponent(token)}`;

export const TAKEOVER_NOTICE = "Staff took over hosting. You're a co-host now: you can still run the game.";
export const COHOST_REMOVED_NOTICE = "You're not a co-host any more. You're playing now.";

/** The server's clock with sub-millisecond steps: buzzes are ordered and timed on it. */
export const preciseNow = (): number => performance.timeOrigin + performance.now();

const MAX_BUZZES_SHOWN = 4;
const MAX_SCORE_ADJUST = 100_000;
const cleanName = (raw: unknown): string => (typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "");
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class Room implements KitRoom {
  readonly members = new Map<string, Member>();
  private readonly contestants = new Map<string, Contestant>();
  private seq = 0;
  hostId = "";
  phase: Phase = "lobby";
  settings: RoomSettings = { ...DEFAULT_SETTINGS };
  /** The board in play: a copy taken when the game starts. */
  private board: Board | null = null;
  private roundIndex = -1;
  private cells: Cell[][] = [];
  private doubleDowns = new Set<string>();
  pickerId: string | null = null;
  private clue: ActiveClue | null = null;
  private lastCall: LastCallState | null = null;
  private winners: string[] = [];
  private timer: NodeJS.Timeout | null = null;

  lastActivityAt = Date.now();
  readonly createdAt = Date.now();
  closed = false;
  /** "patron" for rooms a host's phone creates, "venue" for the box's create_room. */
  kind: SessionKind;
  /** Optional title from the box's create_room. */
  title?: string;
  /**
   * Who may host (the game kit's HostSeats, kit 0.8.0): the host link's key, the box's
   * "first joiner hosts" offer (closed on ANY attach to the host seat, staff's host link
   * included), take-overs and single-use co-host invites. Member roles mirror it: the
   * seat's member is "host", co-hosts are "cohost". createVenueRoom replaces it.
   */
  seats = new HostSeats();

  /** Set by the room registry: closes just this room if one of its timers throws. */
  onFatalError: (err: unknown) => void = () => {};
  /** Set by the room registry: a debounced players_changed (joins, leaves, kicks). */
  onPlayersChanged: () => void = () => {};

  constructor(
    readonly code: string,
    private readonly transport: RoomTransport,
    kind: SessionKind = "patron",
  ) {
    this.kind = kind;
  }

  // ------------------------------------------------------------- members

  addHost(name: string): Member {
    const m = this.newMember("host", cleanName(name) || "Host");
    this.hostId = m.id;
    return m;
  }

  /** The first phone to join a "first joiner hosts" room becomes its host. */
  claimHostSeat(rawName: string | undefined): Member {
    const host = this.members.get(this.hostId);
    if (!host || this.seats.claimForJoiner() !== "host") throw new GameError("BAD_REQUEST");
    host.name = cleanName(rawName) || "Host";
    return host;
  }

  /**
   * The seat a token opens: a member's own token, or the host link's key (the host seat;
   * the phone then keeps that member's own token, so a later take-over, which changes the
   * key, leaves it seated as a co-host).
   */
  seatFor(token: unknown): Member | undefined {
    if (typeof token !== "string" || !token) return undefined;
    return this.findByToken(token) ?? (this.seats.isHostToken(token) ? this.members.get(this.hostId) : undefined);
  }

  /** Anyone attached to a seat. For the host seat this closes the first-joiner offer. */
  noteAttached(member: Member): void {
    if (member.role === "host") this.seats.hostAttached(member.id);
  }

  cohosts(): Member[] {
    return [...this.members.values()].filter((m) => m.role === "cohost");
  }

  /**
   * A co-host invite was redeemed: a new co-host under this name, or a player already in
   * the room promoted (they stop playing). A host, co-host or TV stays what it is.
   */
  seatCohost(existing: Member | undefined, rawName: string | undefined): Member {
    if (existing && existing.role !== "player") return existing;
    let m = existing;
    if (m) {
      const old = m.contestantId;
      m.role = "cohost";
      m.contestantId = null;
      if (old) this.dropIfEmpty(old);
      this.playersChanged();
    } else {
      const name = cleanName(rawName);
      if (!name) throw new GameError("NAME_REQUIRED");
      if (this.nameTaken(name)) throw new GameError("NAME_TAKEN");
      if (this.cohosts().length >= MAX_PLAYERS_PER_ROOM) throw new GameError("ROOM_FULL");
      m = this.newMember("cohost", name);
    }
    this.seats.addCohost(m.id);
    return m;
  }

  /**
   * Staff took over (the box's host_link; the kit already made a new host key and listed the
   * previous holder as a co-host). The previous host's phone stays on as a co-host, and a
   * fresh host seat waits for the new link. Nobody attached yet: nothing to move.
   */
  takeOver(previous: string | undefined): void {
    const old = previous ? this.members.get(previous) : undefined;
    if (!old || old.role !== "host") return;
    old.role = "cohost";
    this.hostId = this.newMember("host", "Venue").id;
    this.notify(old, TAKEOVER_NOTICE);
  }

  /** A co-host plays again: their own seat (solo), or a team under their name (teams). */
  demoteCohost(memberId: string): void {
    const m = this.members.get(memberId);
    this.seats.removeCohost(memberId);
    if (!m || m.role !== "cohost") return;
    if (this.players().some((p) => same(p.name, m.name))) m.name = `${m.name} (co-host)`.slice(0, NAME_MAX);
    const contestant = this.settings.teams ? this.teamNamed(m.name) : this.newContestant(m.name);
    m.role = "player";
    m.contestantId = contestant.id;
    this.playersChanged();
    this.notify(m, COHOST_REMOVED_NOTICE);
  }

  private nameTaken(name: string): boolean {
    return [...this.members.values()].some((m) => (m.role === "player" || m.role === "cohost") && same(m.name, name));
  }

  private notify(m: Member, message: string): void {
    for (const sid of m.socketIds) this.transport.sendNotice(sid, message);
  }

  addTable(): Member {
    const tables = [...this.members.values()].filter((m) => m.role === "table").length;
    if (tables >= MAX_TABLES_PER_ROOM) throw new GameError("ROOM_FULL");
    return this.newMember("table", "Screen");
  }

  /** A new player. Joining mid-game is fine: they start on 0. */
  addPlayer(rawName: string | undefined, rawTeam?: string): Member {
    const name = cleanName(rawName);
    if (!name) throw new GameError("NAME_REQUIRED");
    const players = this.players();
    if (players.length >= MAX_PLAYERS_PER_ROOM) throw new GameError("ROOM_FULL");
    if (this.nameTaken(name)) throw new GameError("NAME_TAKEN");
    const contestant = this.settings.teams ? this.teamNamed(rawTeam) : this.newContestant(name);
    const m = this.newMember("player", name);
    m.contestantId = contestant.id;
    this.playersChanged();
    return m;
  }

  /** Teams only, in the lobby: a player moves to another team (made on the spot if new). */
  setTeam(memberId: string, rawTeam: string | undefined): void {
    const m = this.requirePlayer(memberId);
    if (!this.settings.teams || this.phase !== "lobby") throw new GameError("WRONG_PHASE");
    const old = m.contestantId;
    m.contestantId = this.teamNamed(rawTeam).id;
    if (old && old !== m.contestantId) this.dropIfEmpty(old);
  }

  private teamNamed(rawTeam: string | undefined): Contestant {
    const team = cleanName(rawTeam);
    if (!team) throw new GameError("TEAM_REQUIRED");
    return [...this.contestants.values()].find((c) => same(c.name, team)) ?? this.newContestant(team);
  }

  private newContestant(name: string): Contestant {
    const c: Contestant = { id: newId(), name, score: 0, seq: this.seq++ };
    this.contestants.set(c.id, c);
    // Nobody was in control (everyone had left): the newcomer is.
    if (this.pickerId === null && (this.phase === "board" || this.phase === "clue")) this.pickerId = c.id;
    return c;
  }

  private newMember(role: Role, name: string): Member {
    const m: Member = { id: newId(), token: newToken(), role, name, socketIds: new Set(), contestantId: null, penaltyUntil: 0 };
    this.members.set(m.id, m);
    return m;
  }

  findByToken(token: string): Member | undefined {
    for (const m of this.members.values()) if (m.token === token) return m;
    return undefined;
  }

  attachSocket(member: Member, socketId: string): void {
    member.socketIds.add(socketId);
  }

  detachSocket(memberId: string, socketId: string): void {
    this.members.get(memberId)?.socketIds.delete(socketId);
  }

  removeMember(memberId: string, reason: string): void {
    const m = this.members.get(memberId);
    if (!m) return;
    for (const sid of m.socketIds) this.transport.sendClosed(sid, reason);
    this.members.delete(memberId);
    this.seats.removeCohost(memberId);
    if (m.role !== "player") return;
    if (m.contestantId) this.dropIfEmpty(m.contestantId);
    this.playersChanged();
  }

  /** A team with nobody left (or a solo player who left) leaves the scoreboard. */
  private dropIfEmpty(contestantId: string): void {
    if (this.players().some((p) => p.contestantId === contestantId)) return;
    this.contestants.delete(contestantId);
    if (this.pickerId === contestantId) this.pickerId = this.trailing()?.id ?? null;
    const clue = this.clue;
    if (clue) {
      clue.lockedOut.delete(contestantId);
      if (clue.buzzedBy === contestantId && clue.stage !== "revealed") this.reveal(null);
    }
    if (this.lastCall) {
      this.lastCall.entries = this.lastCall.entries.filter((e) => e.contestantId !== contestantId);
      if (this.lastCall.revealing === contestantId) this.lastCall.revealing = null;
    }
    this.winners = this.winners.filter((id) => id !== contestantId);
  }

  players(): Member[] {
    return [...this.members.values()].filter((m) => m.role === "player");
  }

  private ranked(): Contestant[] {
    return [...this.contestants.values()].sort((a, b) => a.seq - b.seq);
  }

  /** The contestant with the lowest score (earliest to join on a tie): starts each round in control. */
  private trailing(): Contestant | undefined {
    return this.ranked().sort((a, b) => a.score - b.score || a.seq - b.seq)[0];
  }

  /** The host only: ending the room, removing people, co-host invites and removals. */
  requireHost(memberId: string): void {
    if (this.seats.roleOf(memberId) !== "host") throw new GameError("NOT_HOST");
  }

  /** The host or a co-host: running the game (settings, start, buzzers, judging, scores). */
  requireRunner(memberId: string): void {
    if (!this.seats.canRun(memberId)) throw new GameError("NOT_HOST");
  }

  requirePlayer(memberId: string): Member {
    const m = this.members.get(memberId);
    if (!m || m.role !== "player") throw new GameError("NOT_PLAYER");
    return m;
  }

  /** The host, or any phone of the contestant in control. */
  private requireHostOrPicker(memberId: string, pickerAllowed = true): void {
    if (this.seats.canRun(memberId)) return;
    const m = this.members.get(memberId);
    if (!pickerAllowed || !m?.contestantId || m.contestantId !== this.pickerId) throw new GameError("NOT_YOUR_PICK");
  }

  // ---------------------------------------------- the game kit's KitRoom

  playerCount(): number {
    return this.players().length;
  }

  /** Table (TV) clients connected right now. A venue room isn't idle-closed while > 0. */
  tableCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (m.role === "table" && m.socketIds.size > 0) n++;
    return n;
  }

  /** 1-based; Last Call counts as the round after the board's last; 0 in the lobby. */
  round(): number {
    if (!this.board || this.phase === "lobby") return 0;
    return this.lastCall ? this.board.rounds.length + 1 : this.roundIndex + 1;
  }

  hostConnected(): boolean {
    return (this.members.get(this.hostId)?.socketIds.size ?? 0) > 0;
  }

  hostName(): string | undefined {
    return this.members.get(this.hostId)?.name;
  }

  maxPlayers(): number {
    return MAX_PLAYERS_PER_ROOM;
  }

  overviewExtra(): Partial<RoomOverview> {
    const board = this.boardTitle();
    return { title: [this.title, board].filter(Boolean).join(" · ") || undefined };
  }

  private boardTitle(): string {
    return this.board?.title ?? getBoard(this.settings.boardId)?.title ?? "";
  }

  private playersChanged(): void {
    if (!this.closed) this.onPlayersChanged();
  }

  private emit(type: "round_started" | "round_ended" | "winner" | "game_over", data: Record<string, unknown>): void {
    bg.emit({ type, roomCode: this.code, sessionKind: this.kind, data });
  }

  // ------------------------------------------------------------ settings

  updateSettings(patch: Partial<RoomSettings>): void {
    const next = { ...this.settings };
    const lobbyOnly = () => {
      if (this.phase !== "lobby") throw new GameError("WRONG_PHASE");
    };
    const int = (v: unknown, { min, max }: { min: number; max: number }): number => {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n) || n < min || n > max) throw new GameError("BAD_REQUEST");
      return n;
    };
    if (patch.teams !== undefined) {
      lobbyOnly();
      next.teams = Boolean(patch.teams);
    }
    if (patch.boardId !== undefined) {
      lobbyOnly();
      if (typeof patch.boardId !== "string" || !getBoard(patch.boardId)) throw new GameError("NO_BOARD");
      next.boardId = patch.boardId;
    }
    if (patch.doubleDowns !== undefined) {
      lobbyOnly();
      next.doubleDowns = int(patch.doubleDowns, SETTINGS_LIMITS.doubleDowns);
    }
    if (patch.doubleLater !== undefined) {
      lobbyOnly();
      next.doubleLater = Boolean(patch.doubleLater);
    }
    if (patch.lastCall !== undefined) {
      lobbyOnly();
      next.lastCall = Boolean(patch.lastCall);
    }
    if (patch.buzzSeconds !== undefined) next.buzzSeconds = int(patch.buzzSeconds, SETTINGS_LIMITS.buzzSeconds);
    if (patch.earlyPenaltyMs !== undefined) next.earlyPenaltyMs = int(patch.earlyPenaltyMs, SETTINGS_LIMITS.earlyPenaltyMs);
    if (patch.lastCallSeconds !== undefined) next.lastCallSeconds = int(patch.lastCallSeconds, SETTINGS_LIMITS.lastCallSeconds);
    if (patch.wrongCosts !== undefined) next.wrongCosts = Boolean(patch.wrongCosts);
    if (patch.playersPick !== undefined) next.playersPick = Boolean(patch.playersPick);

    const toSolo = this.settings.teams && !next.teams;
    this.settings = next;
    if (toSolo) this.splitTeams();
  }

  /** Teams turned off in the lobby: every player scores for themselves again. */
  private splitTeams(): void {
    const seen = new Set<string>();
    for (const p of this.players()) {
      const c = p.contestantId ? this.contestants.get(p.contestantId) : undefined;
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        c.name = p.name;
      } else p.contestantId = this.newContestant(p.name).id;
    }
  }

  // ---------------------------------------------------------------- game

  startGame(): void {
    if (this.phase !== "lobby") throw new GameError("WRONG_PHASE");
    const board = getBoard(this.settings.boardId);
    if (!board) throw new GameError("NO_BOARD");
    if (this.contestants.size === 0) throw new GameError("NEED_PLAYERS");
    this.board = structuredClone(board) as Board;
    for (const c of this.contestants.values()) c.score = 0;
    this.winners = [];
    this.lastCall = null;
    log.info("game", "started", { code: this.code, board: board.title, contestants: this.contestants.size, teams: this.settings.teams });
    this.startRound(0);
  }

  private startRound(index: number): void {
    const round = this.board!.rounds[index];
    this.roundIndex = index;
    this.clue = null;
    this.cells = round.categories.map((c) => c.clues.map((x): Cell => (x.clue ? "open" : "blank")));
    // Double Downs hide anywhere but the cheapest row.
    this.doubleDowns = new Set();
    const spots: string[] = [];
    this.cells.forEach((col, cat) => col.forEach((cell, row) => cell === "open" && row > 0 && spots.push(`${cat}:${row}`)));
    for (let i = 0; i < this.settings.doubleDowns && spots.length > 0; i++) {
      this.doubleDowns.add(spots.splice(cryptoRand(spots.length), 1)[0]);
    }
    this.pickerId = this.trailing()?.id ?? null;
    this.phase = "board";
    this.emit("round_started", { round: index + 1, rounds: this.board!.rounds.length, board: this.board!.title });
  }

  private value(row: number): number {
    return valueFor(this.roundIndex, row, this.settings.doubleLater);
  }

  /** The most a contestant may wager on a Double Down: their score, or the round's top value if that's more. */
  private wagerMax(c: Contestant | undefined): number {
    return Math.max(c?.score ?? 0, this.value(CLUES_PER_CATEGORY - 1));
  }

  /** Last Call: up to your score, or the last round's top value if that's more (so nobody is shut out). */
  private lastCallMax(c: Contestant | undefined): number {
    const top = valueFor(this.board!.rounds.length - 1, CLUES_PER_CATEGORY - 1, this.settings.doubleLater);
    return Math.max(c?.score ?? 0, top);
  }

  pickSquare(memberId: string, cat: number, row: number): void {
    if (this.phase !== "board") throw new GameError("WRONG_PHASE");
    this.requireHostOrPicker(memberId, this.settings.playersPick);
    if (this.cells[cat]?.[row] !== "open") throw new GameError("BAD_REQUEST");
    // With nobody in control, a Double Down plays as an ordinary clue.
    const doubleDown = this.doubleDowns.has(`${cat}:${row}`) && this.pickerId !== null && this.contestants.has(this.pickerId);
    this.clue = {
      cat,
      row,
      doubleDown,
      stage: doubleDown ? "wager" : "reading",
      buzzedBy: doubleDown ? this.pickerId : null,
      buzzedName: doubleDown ? (this.contestants.get(this.pickerId!)?.name ?? null) : null,
      lockedOut: new Set(),
      openedAt: 0,
      deadline: null,
      wager: null,
      winnerId: null,
      buzzes: [],
    };
    this.phase = "clue";
  }

  /** Double Down: the wager, from the picker's phone or typed in by the host. */
  setWager(memberId: string, amount: unknown): void {
    const clue = this.clue;
    if (this.phase !== "clue" || !clue || clue.stage !== "wager") throw new GameError("WRONG_PHASE");
    this.requireHostOrPicker(memberId);
    const n = Number(amount);
    if (!Number.isInteger(n) || n < MIN_WAGER || n > this.wagerMax(this.contestants.get(clue.buzzedBy!))) throw new GameError("BAD_WAGER");
    clue.wager = n;
    clue.stage = "answering";
  }

  openBuzzers(): void {
    const clue = this.clue;
    if (this.phase !== "clue" || !clue || clue.stage !== "reading") throw new GameError("WRONG_PHASE");
    this.open(clue);
  }

  private open(clue: ActiveClue): void {
    clue.stage = "open";
    clue.buzzedBy = null;
    clue.buzzedName = null;
    clue.buzzes = [];
    clue.openedAt = preciseNow();
    const ms = this.settings.buzzSeconds * 1000;
    clue.deadline = Date.now() + ms;
    this.setTimer("buzzClock", ms, () => {
      if (this.clue === clue && clue.stage === "open") this.reveal(null);
    });
  }

  /**
   * A phone's buzz, stamped `at` on arrival (the server's clock; phones never decide).
   * Node handles one socket event at a time, so the first buzz to arrive while the
   * buzzers are open wins, and a tie goes to the earlier event.
   *
   * `tell`: who needs a new view. Ignored buzzes tell nobody, so mashing costs nothing.
   */
  buzz(memberId: string, at: number): { result: BuzzResult; tell: "all" | "self" | "none" } {
    const m = this.requirePlayer(memberId);
    const clue = this.clue;
    const contestantId = m.contestantId;
    if (this.phase !== "clue" || !clue || !contestantId || clue.doubleDown) return { result: "closed", tell: "none" };
    if (clue.stage === "reading") {
      // Too soon: this phone sits out a moment, so jumping the gun never wins.
      m.penaltyUntil = at + this.settings.earlyPenaltyMs;
      return { result: "early", tell: "self" };
    }
    if (clue.stage === "answering") {
      // Too late. Kept (one per contestant, a few at most) to show how close it was.
      const seen = clue.buzzes.some((b) => b.contestantId === contestantId);
      if (seen || clue.lockedOut.has(contestantId) || at < m.penaltyUntil || clue.buzzes.length >= MAX_BUZZES_SHOWN) {
        return { result: "late", tell: "none" };
      }
      clue.buzzes.push({ contestantId, name: m.name, ms: Math.max(0, Math.round(at - clue.openedAt)) });
      return { result: "late", tell: "all" };
    }
    if (clue.stage !== "open") return { result: "closed", tell: "none" };
    if (at < m.penaltyUntil) return { result: "penalty", tell: "none" };
    if (clue.lockedOut.has(contestantId)) return { result: "locked", tell: "none" };
    clue.stage = "answering";
    clue.buzzedBy = contestantId;
    clue.buzzedName = m.name;
    clue.deadline = null;
    clue.buzzes = [{ contestantId, name: m.name, ms: Math.max(0, Math.round(at - clue.openedAt)) }];
    this.clearTimer();
    return { result: "first", tell: "all" };
  }

  /** The host marks the answer right or wrong. */
  judge(correct: boolean): void {
    const clue = this.clue;
    if (this.phase !== "clue" || !clue || clue.stage !== "answering") throw new GameError("WRONG_PHASE");
    const c = clue.buzzedBy ? this.contestants.get(clue.buzzedBy) : undefined;
    if (!c) throw new GameError("WRONG_PHASE");
    const amount = clue.doubleDown ? (clue.wager ?? 0) : this.value(clue.row);
    if (correct) {
      c.score += amount;
      this.pickerId = c.id; // right answer: they pick next
      this.reveal(c.id);
      return;
    }
    if (clue.doubleDown || this.settings.wrongCosts) c.score -= amount;
    if (clue.doubleDown) return this.reveal(null);
    clue.lockedOut.add(c.id);
    // Everyone else gets another go, on a fresh clock.
    if ([...this.contestants.keys()].every((id) => clue.lockedOut.has(id))) this.reveal(null);
    else this.open(clue);
  }

  /** The host gives up on a clue: the answer goes up and nobody scores. */
  skipClue(): void {
    const clue = this.clue;
    if (this.phase !== "clue" || !clue || clue.stage === "revealed") throw new GameError("WRONG_PHASE");
    this.reveal(null);
  }

  /** A square picked by mistake goes back on the board (before the buzzers open). */
  cancelClue(): void {
    const clue = this.clue;
    if (this.phase !== "clue" || !clue || (clue.stage !== "reading" && clue.stage !== "wager")) throw new GameError("WRONG_PHASE");
    this.clue = null;
    this.phase = "board";
  }

  private reveal(winnerId: string | null): void {
    const clue = this.clue;
    if (!clue) return;
    this.clearTimer();
    clue.stage = "revealed";
    clue.winnerId = winnerId;
    clue.deadline = null;
    if (!winnerId) {
      clue.buzzedBy = null;
      clue.buzzedName = null;
    }
    this.cells[clue.cat][clue.row] = "used";
  }

  /** After the answer: back to the board, or the round is over. */
  continueGame(): void {
    if (this.phase !== "clue" || this.clue?.stage !== "revealed") throw new GameError("WRONG_PHASE");
    this.clue = null;
    if (this.cells.some((col) => col.includes("open"))) this.phase = "board";
    else this.endRound();
  }

  private endRound(): void {
    this.phase = "roundEnd";
    this.emit("round_ended", { round: this.roundIndex + 1 });
  }

  private hasLastCall(): boolean {
    return this.settings.lastCall && !!this.board?.lastCall;
  }

  /** On to the next round, then Last Call, then the final scores. From the board it skips what's left. */
  nextRound(): void {
    if (this.phase === "board") this.endRound();
    else if (this.phase !== "roundEnd") throw new GameError("WRONG_PHASE");
    const board = this.board!;
    if (this.roundIndex + 1 < board.rounds.length) this.startRound(this.roundIndex + 1);
    else if (this.hasLastCall() && this.contestants.size > 0) this.startLastCall();
    else this.finish();
  }

  // ----------------------------------------------------------- Last Call

  private startLastCall(): void {
    this.phase = "lastCall";
    this.lastCall = {
      stage: "wager",
      deadline: null,
      entries: this.ranked().map((c) => ({ contestantId: c.id, wager: null, answer: "", shown: false, correct: null })),
      revealing: null,
    };
    this.emit("round_started", { round: this.board!.rounds.length + 1, rounds: this.board!.rounds.length, lastCall: true });
  }

  private myEntry(memberId: string, stage: LastCallStage): LastCallEntry {
    const m = this.requirePlayer(memberId);
    const lc = this.lastCall;
    if (this.phase !== "lastCall" || !lc || lc.stage !== stage) throw new GameError("WRONG_PHASE");
    const entry = lc.entries.find((e) => e.contestantId === m.contestantId);
    if (!entry) throw new GameError("WRONG_PHASE");
    return entry;
  }

  /** A secret wager. Any phone on the team may set it, and change it until the clue goes up. */
  lastCallWager(memberId: string, amount: unknown): void {
    const entry = this.myEntry(memberId, "wager");
    const n = Number(amount);
    if (!Number.isInteger(n) || n < 0 || n > this.lastCallMax(this.contestants.get(entry.contestantId))) throw new GameError("BAD_WAGER");
    entry.wager = n;
  }

  /** The typed answer; the last one in before the clock runs out counts. */
  lastCallAnswer(memberId: string, text: unknown): void {
    const entry = this.myEntry(memberId, "answer");
    entry.answer = typeof text === "string" ? text.replace(/\s+/g, " ").trim().slice(0, LAST_CALL_ANSWER_MAX) : "";
  }

  /** The host's one button through Last Call: show the clue, lock the answers, reveal the next, finish. */
  lastCallAdvance(): void {
    const lc = this.lastCall;
    if (this.phase !== "lastCall" || !lc) throw new GameError("WRONG_PHASE");
    if (lc.stage === "wager") {
      for (const e of lc.entries) e.wager ??= 0; // no wager in time: nothing at stake
      lc.stage = "answer";
      const ms = this.settings.lastCallSeconds * 1000;
      lc.deadline = Date.now() + ms;
      this.setTimer("lastCallClock", ms, () => {
        if (this.lastCall === lc && lc.stage === "answer") this.lockLastCall(lc);
      });
    } else if (lc.stage === "answer") {
      this.lockLastCall(lc);
    } else {
      const current = lc.entries.find((e) => e.contestantId === lc.revealing);
      if (current && current.correct === null) throw new GameError("WRONG_PHASE"); // judge this one first
      const next = lc.entries.find((e) => e.correct === null);
      if (!next) return this.finish();
      next.shown = true;
      lc.revealing = next.contestantId;
    }
  }

  private lockLastCall(lc: LastCallState): void {
    this.clearTimer();
    lc.stage = "reveal";
    lc.deadline = null;
    lc.revealing = null;
    // Revealed from the lowest score up.
    const score = (e: LastCallEntry) => this.contestants.get(e.contestantId)?.score ?? 0;
    lc.entries.sort((a, b) => score(a) - score(b));
  }

  lastCallJudge(correct: boolean): void {
    const lc = this.lastCall;
    if (this.phase !== "lastCall" || !lc || lc.stage !== "reveal") throw new GameError("WRONG_PHASE");
    const entry = lc.entries.find((e) => e.contestantId === lc.revealing);
    const c = entry ? this.contestants.get(entry.contestantId) : undefined;
    if (!entry || !c || entry.correct !== null) throw new GameError("WRONG_PHASE");
    entry.correct = correct;
    c.score += (correct ? 1 : -1) * (entry.wager ?? 0);
  }

  private finish(): void {
    this.clearTimer();
    const lastRound = this.round();
    this.clue = null;
    this.phase = "final";
    const standings = this.ranked().sort((a, b) => b.score - a.score || a.seq - b.seq);
    const top = standings[0]?.score;
    this.winners = standings.filter((c) => c.score === top).map((c) => c.id);
    const names = standings.filter((c) => c.score === top).map((c) => c.name);
    log.info("game", "finished", { code: this.code, winners: names.join(","), score: top });
    if (this.lastCall) this.emit("round_ended", { round: lastRound });
    for (const name of names) this.emit("winner", { name, score: top });
    this.emit("game_over", { winners: names });
    // The venue's leaderboard (a no-op off a box). Tied scores share a place.
    let place = 0;
    void bg.reportResults({
      roomCode: this.code,
      results: standings.map((c, i) => {
        if (i === 0 || c.score !== standings[i - 1].score) place = i + 1;
        return { player: { name: c.name }, place, score: c.score };
      }),
    });
  }

  /** Back to the lobby with the same players, scores cleared. "Play again", or "Start over" mid-game. */
  playAgain(): void {
    if (this.phase === "lobby") throw new GameError("WRONG_PHASE");
    this.clearTimer();
    this.phase = "lobby";
    this.board = null;
    this.roundIndex = -1;
    this.cells = [];
    this.doubleDowns = new Set();
    this.clue = null;
    this.lastCall = null;
    this.winners = [];
    this.pickerId = null;
    for (const c of this.contestants.values()) c.score = 0;
    for (const m of this.members.values()) m.penaltyUntil = 0;
  }

  /** The host fixes a score (a judging slip). */
  adjustScore(contestantId: string, delta: unknown): void {
    const c = this.contestants.get(contestantId);
    const n = Number(delta);
    if (!c || !Number.isInteger(n) || Math.abs(n) > MAX_SCORE_ADJUST) throw new GameError("BAD_REQUEST");
    if (this.phase === "lobby") throw new GameError("WRONG_PHASE");
    c.score += n;
  }

  /** The host hands control of the board to someone. */
  setPicker(contestantId: string): void {
    if (!this.contestants.has(contestantId)) throw new GameError("BAD_REQUEST");
    this.pickerId = contestantId;
  }

  // -------------------------------------------------------------- timers

  /** Every room timer goes through the kit's safeTimeout: a throw closes this room only. */
  private setTimer(label: string, ms: number, fn: () => void): void {
    this.clearTimer();
    this.timer = safeTimeout(
      label,
      ms,
      () => {
        this.timer = null;
        if (this.closed) return;
        fn();
        this.broadcast();
      },
      (err) => this.onFatalError(err),
    );
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  // --------------------------------------------------------------- views

  /** Everyone gets the new state in the same tick: who buzzed in, and "locked" for the rest. */
  broadcast(): void {
    this.lastActivityAt = Date.now();
    for (const m of this.members.values()) {
      if (m.socketIds.size === 0) continue;
      const view = this.viewFor(m);
      for (const sid of m.socketIds) this.transport.sendState(sid, view);
    }
  }

  sendTo(memberId: string): void {
    const m = this.members.get(memberId);
    if (!m) return;
    const view = this.viewFor(m);
    for (const sid of m.socketIds) this.transport.sendState(sid, view);
  }

  private clueView(isHost: boolean): ClueView | null {
    const clue = this.clue;
    if (!clue || !this.board) return null;
    const category = this.board.rounds[this.roundIndex].categories[clue.cat];
    const item = category.clues[clue.row];
    return {
      cat: clue.cat,
      row: clue.row,
      category: category.name,
      value: this.value(clue.row),
      doubleDown: clue.doubleDown,
      stage: clue.stage,
      text: clue.stage === "wager" && !isHost ? null : item.clue,
      answer: isHost || clue.stage === "revealed" ? item.answer : null,
      buzzedBy: clue.buzzedBy,
      buzzedName: clue.buzzedName,
      lockedOut: [...clue.lockedOut],
      deadline: clue.deadline,
      wager: clue.wager,
      wagerMax: clue.doubleDown ? this.wagerMax(this.contestants.get(clue.buzzedBy ?? "")) : 0,
      winnerId: clue.winnerId,
      buzzes: clue.buzzes.slice(),
    };
  }

  private lastCallView(m: Member, isHost: boolean): LastCallView | null {
    const lc = this.lastCall;
    const item = this.board?.lastCall;
    if (!lc || !item) return null;
    const allJudged = lc.stage === "reveal" && lc.entries.every((e) => e.correct !== null);
    const mine = m.role === "player" ? lc.entries.find((e) => e.contestantId === m.contestantId) : undefined;
    return {
      stage: lc.stage,
      category: item.category,
      text: lc.stage === "wager" && !isHost ? null : item.clue,
      answer: isHost || allJudged || this.phase === "final" ? item.answer : null,
      deadline: lc.deadline,
      entries: lc.entries.map((e) => ({
        contestantId: e.contestantId,
        wagered: e.wager !== null,
        answered: e.answer !== "",
        answer: e.shown ? e.answer : null,
        wager: e.correct !== null ? e.wager : null,
        correct: e.correct,
      })),
      revealing: lc.revealing,
      mine: mine ? { wager: mine.wager, answer: mine.answer, wagerMax: this.lastCallMax(this.contestants.get(mine.contestantId)) } : null,
    };
  }

  viewFor(m: Member): RoomView {
    const now = preciseNow();
    // Host and co-hosts see the answers and the boards: they run the game.
    const isHost = m.role === "host" || m.role === "cohost";
    const players = this.players();
    const round = this.board && this.roundIndex >= 0 ? this.board.rounds[this.roundIndex] : null;
    const inGame = this.phase !== "lobby" && this.board !== null;
    return {
      code: this.code,
      kind: this.kind,
      you: {
        id: m.id,
        role: m.role,
        name: m.name,
        contestantId: m.contestantId,
        // Sent on the wall clock, like serverTime: the high-resolution clock the penalty is kept
        // on drifts from Date.now() while the process runs (83 ms was seen), which would skew
        // the phone's "locked" countdown.
        penaltyUntil: m.penaltyUntil > now ? Math.ceil(Date.now() + (m.penaltyUntil - now)) : null,
      },
      phase: this.phase,
      serverTime: Date.now(),
      settings: { ...this.settings },
      boardTitle: this.boardTitle(),
      round: this.round(),
      roundCount: this.board?.rounds.length ?? getBoard(this.settings.boardId)?.rounds.length ?? 0,
      hasLastCall: inGame ? this.hasLastCall() : this.settings.lastCall && !!getBoard(this.settings.boardId)?.lastCall,
      contestants: this.ranked().map((c) => {
        const members = players.filter((p) => p.contestantId === c.id);
        return {
          id: c.id,
          name: c.name,
          score: c.score,
          connected: members.some((p) => p.socketIds.size > 0),
          members: members.map((p) => ({ id: p.id, name: p.name, connected: p.socketIds.size > 0 })),
        };
      }),
      pickerId: this.pickerId,
      grid:
        inGame && round && (this.phase === "board" || this.phase === "clue" || this.phase === "roundEnd")
          ? {
              categories: round.categories.map((c) => c.name),
              values: Array.from({ length: CLUES_PER_CATEGORY }, (_, row) => this.value(row)),
              cells: this.cells.map((col) => col.slice()),
            }
          : null,
      clue: this.phase === "clue" ? this.clueView(isHost) : null,
      lastCall: this.phase === "lastCall" || this.phase === "final" ? this.lastCallView(m, isHost) : null,
      winners: this.winners.slice(),
      hostOpen: this.seats.offerOpen,
      cohosts: isHost ? this.cohosts().map((c) => ({ id: c.id, name: c.name, connected: c.socketIds.size > 0 })) : [],
      hostConnected: this.hostConnected(),
      tableCount: this.tableCount(),
      boards: isHost && this.phase === "lobby" ? listBoards() : [],
    };
  }

  /** What the /admin room list shows. */
  summary(): AdminRoomSummary {
    const players = this.players();
    return {
      code: this.code,
      kind: this.kind,
      createdAt: this.createdAt,
      lastActivityAt: this.lastActivityAt,
      phase: this.phase,
      round: this.round(),
      boardTitle: this.boardTitle(),
      hostConnected: this.hostConnected(),
      players: players.length,
      playersConnected: players.filter((p) => p.socketIds.size > 0).length,
      tables: this.tableCount(),
    };
  }

  close(reason: string, _cause?: CloseCause): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    for (const m of this.members.values()) for (const sid of m.socketIds) this.transport.sendClosed(sid, reason);
  }
}
