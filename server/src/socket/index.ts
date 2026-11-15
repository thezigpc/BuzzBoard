import type { Server, Socket } from "socket.io";
import {
  ERRORS,
  type BuzzResult,
  type ClientToServerEvents,
  type JoinResult,
  type RoomSettings,
  type ServerToClientEvents,
} from "@buzzboard/shared";
import { log } from "@bargames/gamekit/server";
import { clientIp, tvs } from "../bargames.js";
import { GameError } from "../rooms/errors.js";
import { cohostPath, preciseNow, type Member, type Room } from "../rooms/Room.js";
import { HOST_CLOSE_REASON, type Rooms } from "../rooms/registry.js";

interface SocketData {
  code?: string;
  memberId?: string;
  lastEvent?: string;
}
export type IO = Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type S = Socket<ClientToServerEvents, ServerToClientEvents, object, SocketData>;
type AckFn = (res: { ok: boolean; [k: string]: unknown }) => void;

// Failed join/resume attempts per IP: the room code is the only gate on the join URL,
// so guessing codes must not be free.
const JOIN_WINDOW_MS = 60_000;
const JOIN_FAILS_ALLOWED = 20;
const joinFails = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (joinFails.get(ip) ?? []).filter((t) => now - t < JOIN_WINDOW_MS);
  joinFails.set(ip, recent);
  return recent.length >= JOIN_FAILS_ALLOWED;
}
function noteJoinFail(ip: string): void {
  const list = joinFails.get(ip) ?? [];
  list.push(Date.now());
  joinFails.set(ip, list);
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of joinFails) if (list.every((t) => now - t >= JOIN_WINDOW_MS)) joinFails.delete(ip);
}, JOIN_WINDOW_MS).unref();

export function registerSocketHandlers(io: IO, rooms: Rooms): void {
  io.on("connection", (socket: S) => {
    // The real address: the gateway's header on a Bar Games box, cf-connecting-ip behind
    // a tunnel, the socket's own otherwise. clientIp() picks the right one.
    const ip = clientIp(socket.request);
    socket.onAny((event: string) => {
      socket.data.lastEvent = event;
    });

    const fail = (ack: AckFn | undefined, err: unknown) => {
      if (!(err instanceof GameError)) {
        log.error("socket", "handler threw", { event: socket.data.lastEvent, err: String(err) });
      }
      log.warn("socket", "rejected", {
        event: socket.data.lastEvent,
        code: socket.data.code,
        member: socket.data.memberId,
        error: err instanceof GameError ? err.code : "INTERNAL",
      });
      if (typeof ack === "function") {
        ack({ ok: false, error: err instanceof GameError ? err.message : ERRORS.BAD_REQUEST });
      }
    };

    const unbind = () => {
      const { code, memberId } = socket.data;
      socket.data.code = undefined;
      socket.data.memberId = undefined;
      if (code && memberId) {
        const room = rooms.get(code);
        if (room) {
          room.detachSocket(memberId, socket.id);
          room.broadcast();
        }
      }
    };

    const bind = (room: Room, member: Member): JoinResult => {
      if (socket.data.code !== room.code || socket.data.memberId !== member.id) unbind();
      room.attachSocket(member, socket.id);
      // "First joiner hosts": once anyone holds the host seat (staff's host link, or the
      // first phone), the next phone is a player (the kit's HostSeats.hostAttached). Before
      // 0.2.0 a phone joining after staff opened the host link got the same seat.
      room.noteAttached(member);
      socket.data.code = room.code;
      socket.data.memberId = member.id;
      return { code: room.code, token: member.token, memberId: member.id, role: member.role, name: member.name };
    };

    const current = (): { room: Room; memberId: string } => {
      const { code, memberId } = socket.data;
      const room = code ? rooms.get(code) : undefined;
      if (!room || !memberId || !room.members.has(memberId)) throw new GameError("NOT_IN_ROOM");
      return { room, memberId };
    };

    const listen = socket.on.bind(socket) as (e: string, h: (...args: unknown[]) => void) => void;
    const split = <A>(args: unknown[]) => ({
      ack: args[args.length - 1] as AckFn | undefined,
      arg: (args.length > 1 ? args[0] : undefined) as A,
    });

    /** Runs a room-scoped intent, then broadcasts the new state to everyone. */
    function on<A>(event: keyof ClientToServerEvents, fn: (room: Room, memberId: string, arg: A) => object | void) {
      listen(event, (...args) => {
        const { ack, arg } = split<A>(args);
        try {
          const { room, memberId } = current();
          const result = fn(room, memberId, arg) ?? {};
          room.broadcast();
          if (typeof ack === "function") ack({ ok: true, ...result });
        } catch (err) {
          fail(ack, err);
        }
      });
    }
    /** The same, for the host only (ending, removing people, co-hosts). */
    const onHost = <A>(event: keyof ClientToServerEvents, fn: (room: Room, arg: A) => object | void) =>
      on<A>(event, (room, id, arg) => {
        room.requireHost(id);
        return fn(room, arg);
      });
    /** The same, for the host or a co-host (running the game). */
    const onRunner = <A>(event: keyof ClientToServerEvents, fn: (room: Room, arg: A) => object | void) =>
      on<A>(event, (room, id, arg) => {
        room.requireRunner(id);
        return fn(room, arg);
      });

    /** Host or co-host, async (the venue-TV calls go to the box). No broadcast. */
    function onHostAsync<A>(event: keyof ClientToServerEvents, fn: (room: Room, arg: A) => Promise<object>) {
      listen(event, async (...args) => {
        const { ack, arg } = split<A>(args);
        try {
          const { room, memberId } = current();
          room.requireRunner(memberId);
          const result = await fn(room, arg);
          if (typeof ack === "function") ack({ ok: true, ...result });
        } catch (err) {
          fail(ack, err);
        }
      });
    }

    // ------------------------------------------------------------ the buzz
    // Stamped the moment the event is handled, before anything else. A buzz that came
    // in over long-polling is refused: polling batches events, so its arrival time says
    // little about when the button was pressed. Clients connect by WebSocket first.
    listen("buzz", (...args) => {
      const at = preciseNow();
      const ack = typeof args[args.length - 1] === "function" ? (args[args.length - 1] as AckFn) : undefined;
      try {
        const { room, memberId } = current();
        if (socket.conn.transport.name !== "websocket") throw new GameError("SLOW_LINK");
        const { result, tell } = room.buzz(memberId, at);
        if (tell === "all") room.broadcast();
        else if (tell === "self") room.sendTo(memberId);
        if (result === "first") log.info("game", "buzz", { code: room.code, member: memberId });
        ack?.({ ok: true, result: result satisfies BuzzResult });
      } catch (err) {
        fail(ack, err);
      }
    });

    // Venue TVs (Bar Games box only; off a box: enabled false and every cast refused).
    onHostAsync("listTvs", async () => ({ tvs: await tvs.list() }));
    onHostAsync("castToTvs", async (room, req) => {
      const result = await tvs.cast(room, req);
      log.info("room", "cast to TVs", { code: room.code, ok: result.ok });
      return { result };
    });
    onHostAsync("stopTvs", async (room, req) => {
      const result = await tvs.stop(req);
      log.info("room", "stopped TVs", { code: room.code, ok: result.ok });
      return { result };
    });

    // -------------------------------------------------- rooms and seats
    socket.on("createRoom", (req, ack) => {
      try {
        const room = rooms.create("patron");
        const result = bind(room, room.addHost(String(req?.name ?? "")));
        log.info("room", "created", { code: room.code });
        ack({ ok: true, ...result });
        room.broadcast();
      } catch (err) {
        fail(ack as AckFn, err);
      }
    });

    const findRoom = (code: unknown): Room => {
      if (rateLimited(ip)) throw new GameError("RATE_LIMITED");
      const room = rooms.get(String(code ?? ""));
      if (!room) {
        noteJoinFail(ip);
        throw new GameError("ROOM_NOT_FOUND");
      }
      return room;
    };

    // The join form asks first: does this room use teams, and is its host seat open?
    socket.on("roomInfo", (req, ack) => {
      try {
        const room = findRoom(req?.code);
        const view = room.viewFor({ id: "", token: "", role: "table", name: "", socketIds: new Set(), contestantId: null, penaltyUntil: 0 });
        ack({
          ok: true,
          teams: view.settings.teams,
          teamNames: view.settings.teams ? view.contestants.map((c) => c.name) : [],
          hostOpen: view.hostOpen,
          phase: view.phase,
        });
      } catch (err) {
        fail(ack as AckFn, err);
      }
    });

    socket.on("joinRoom", (req, ack) => {
      try {
        const room = findRoom(req?.code);
        if (req.role !== "player" && req.role !== "table") throw new GameError("BAD_REQUEST");
        // A known token (or the host link's key) means "same seat again", never a second seat.
        const existing = room.seatFor(req.token);
        let member: Member;
        if (req.cohost !== undefined) {
          // A co-host invite (the host's or the box's "Add a co-host" QR): single use.
          if (req.role !== "player" || !room.seats.redeem(req.cohost)) throw new GameError("BAD_INVITE");
          member = room.seatCohost(existing, req.name);
        } else {
          member =
            existing ??
            (req.role === "table"
              ? room.addTable()
              : room.seats.offerOpen
                ? room.claimHostSeat(req.name) // a box room nobody hosts yet: the first phone in does
                : room.addPlayer(req.name, req.team));
        }
        const result = bind(room, member);
        log.info("room", existing ? "rejoined" : "joined", { code: room.code, role: member.role, name: member.name });
        ack({ ok: true, ...result });
        room.broadcast();
      } catch (err) {
        fail(ack as AckFn, err);
      }
    });

    // Sent by the client on EVERY socket connect, not just the first: socket.io
    // reconnects with a brand-new server-side socket that has no room binding.
    socket.on("resume", (req, ack) => {
      try {
        const room = findRoom(req?.code);
        const member = room.seatFor(req?.token);
        if (!member) {
          noteJoinFail(ip);
          // An old host link (after a take-over) says so; anything else is an expired seat.
          throw new GameError(req?.host ? "BAD_HOST_LINK" : "BAD_TOKEN");
        }
        const result = bind(room, member);
        log.info("room", "resumed", { code: room.code, role: member.role, name: member.name });
        ack({ ok: true, ...result });
        room.broadcast();
      } catch (err) {
        fail(ack as AckFn, err);
      }
    });

    socket.on("leaveRoom", (ack) => {
      const { code, memberId } = socket.data;
      const room = code ? rooms.get(code) : undefined;
      socket.data.code = undefined;
      socket.data.memberId = undefined;
      if (room && memberId) {
        if (memberId === room.hostId) {
          rooms.closeRoom(room.code, HOST_CLOSE_REASON, "host");
        } else {
          room.detachSocket(memberId, socket.id);
          room.removeMember(memberId, "You left the room.");
          log.info("room", "left", { code: room.code, member: memberId });
          room.broadcast();
        }
      }
      ack({ ok: true });
    });

    socket.on("closeRoom", (ack) => {
      try {
        const { room, memberId } = current();
        room.requireHost(memberId);
        rooms.closeRoom(room.code, HOST_CLOSE_REASON, "host");
        ack({ ok: true });
      } catch (err) {
        fail(ack as AckFn, err);
      }
    });

    // ---------------------------------------------- host or co-host
    onRunner<Partial<RoomSettings>>("updateSettings", (room, patch) => room.updateSettings(patch ?? {}));
    onRunner("startGame", (room) => room.startGame());
    onRunner("openBuzzers", (room) => room.openBuzzers());
    onRunner<{ correct: boolean }>("judge", (room, req) => room.judge(req?.correct === true));
    onRunner("skipClue", (room) => room.skipClue());
    onRunner("cancelClue", (room) => room.cancelClue());
    onRunner("continueGame", (room) => room.continueGame());
    onRunner("nextRound", (room) => room.nextRound());
    onRunner("lastCallAdvance", (room) => room.lastCallAdvance());
    onRunner<{ correct: boolean }>("lastCallJudge", (room, req) => room.lastCallJudge(req?.correct === true));
    onRunner<{ contestantId: string; delta: number }>("adjustScore", (room, req) =>
      room.adjustScore(String(req?.contestantId ?? ""), req?.delta),
    );
    onRunner<{ contestantId: string }>("setPicker", (room, req) => room.setPicker(String(req?.contestantId ?? "")));
    onRunner("playAgain", (room) => room.playAgain());

    // ------------------------------------------------------- host only
    onHost<string>("kickPlayer", (room, target) => {
      if (target === room.hostId || !room.members.has(target)) throw new GameError("BAD_REQUEST");
      room.removeMember(target, "The host removed you from the room.");
    });
    // Co-hosts (0.2.0): the host hands out single-use invites and removes co-hosts.
    onHost("cohostInvite", (room) => {
      const inv = room.seats.invite();
      log.info("room", "co-host invite", { code: room.code, expiresAt: inv.expiresAt });
      return { path: cohostPath(room, inv.token), expiresAt: inv.expiresAt };
    });
    onHost<string>("removeCohost", (room, target) => {
      if (!room.seats.isCohost(String(target))) throw new GameError("BAD_REQUEST");
      room.demoteCohost(String(target));
    });

    // ------------------------------- the host, or the player in control
    on<{ cat: number; row: number }>("pickSquare", (room, id, req) => room.pickSquare(id, Number(req?.cat), Number(req?.row)));
    on<{ amount: number }>("setWager", (room, id, req) => room.setWager(id, req?.amount));

    // ---------------------------------------------------------- players
    on<{ team: string }>("setTeam", (room, id, req) => room.setTeam(id, req?.team));
    on<{ amount: number }>("lastCallWager", (room, id, req) => room.lastCallWager(id, req?.amount));
    on<{ text: string }>("lastCallAnswer", (room, id, req) => room.lastCallAnswer(id, req?.text));

    socket.on("disconnect", () => unbind());
  });
}
