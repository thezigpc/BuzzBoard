// The game's single connection to a Bar Games box (see BARGAMES.md).
//
// Off a box (no BG_CORE_URL / BG_GAME_TOKEN env) every call here is a no-op and the game
// runs by itself: that's guaranteed by the SDK.

import { wireBarGames } from "@bargames/gamekit/bargames";
import { createBarGames, type CommandResult } from "@bargames/sdk/server";
import type { IncomingMessage } from "node:http";
import { DEFAULT_GAME_NAME } from "@buzzboard/shared";
import { createVenueRoom, HOST_CLOSE_REASON, type Rooms } from "./rooms/registry.js";
import type { Room } from "./rooms/Room.js";

export const bg = createBarGames({
  gameId: "buzzboard",
  defaultName: process.env.GAME_NAME || DEFAULT_GAME_NAME,
});

/** True when running on a box. Guards anything box-only. */
export const onBox = bg.connected;

/** The real client IP for rate limits and logs (the gateway's header on a box). */
export const clientIp = (req: IncomingMessage): string => bg.clientIp(req);

/** Display name: the venue's rename on a box, otherwise GAME_NAME. */
export async function displayName(fallback: string): Promise<string> {
  return onBox ? (await bg.venue()).game.displayName : fallback;
}

/** TV ids and PIN from a host's cast request, bounded. Bad input: no ids. */
function castArgs(req: unknown): { ids: string[]; pin?: string } {
  const r = (req ?? {}) as { ids?: unknown; pin?: unknown };
  const ids = Array.isArray(r.ids)
    ? r.ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 200).slice(0, 50)
    : [];
  const pin = typeof r.pin === "string" && r.pin ? r.pin.slice(0, 32) : undefined;
  return { ids, pin };
}

/**
 * Casting from the host screen. Callers check the room's host first. Off a box the SDK
 * answers enabled: false / ok: false without any network call.
 */
export const tvs = {
  list: () => bg.displays(),
  cast: (room: Room, req: unknown) => {
    const { ids, pin } = castArgs(req);
    return ids.length ? bg.cast(room.code, ids, { pin }) : Promise.resolve({ ok: false, message: "Pick a TV first." });
  },
  stop: (req: unknown) => {
    const { ids, pin } = castArgs(req);
    return ids.length ? bg.stopCast(ids, { pin }) : Promise.resolve({ ok: false, message: "Pick a TV first." });
  },
};

/**
 * Level 3, through the game kit's wireBarGames: status (every room's overview), the
 * room_created / room_closed / players_changed events, "end" and create_room. Each
 * command runs the same Room method the host's socket intent does, then broadcasts.
 * A GameError thrown by the room comes back as { ok: false, message }.
 */
export function registerBarGames(rooms: Rooms): void {
  const asHost =
    (fn: (room: Room) => void) =>
    (room: Room): CommandResult => {
      fn(room);
      room.broadcast();
      return { ok: true };
    };

  wireBarGames(bg, rooms, {
    // The box starts a room for its TVs. No host phone: hostUrl opens the empty host
    // seat on the staff iPad, or (firstJoinerHosts) the first phone to scan the TV's QR
    // code takes it.
    createVenueRoom: ({ kind, title, firstJoinerHosts }) => {
      const { room, hostToken } = createVenueRoom(rooms, kind ?? "venue", title, firstJoinerHosts === true);
      room.broadcast();
      return { room, hostUrl: `/join/${room.code}?host=${encodeURIComponent(hostToken)}` };
    },
    commands: {
      // The host's Start. After a finished game it starts another with the same players.
      start: asHost((room) => {
        if (room.phase === "final") room.playAgain();
        room.startGame();
      }),
      // The host's "Next round": on to the next round, Last Call, or the final scores.
      next_round: asHost((room) => room.nextRound()),
    },
    endReason: HOST_CLOSE_REASON,
    endCause: "host",
  });
}
