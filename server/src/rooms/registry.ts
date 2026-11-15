// The room registry (the game kit's RoomRegistry): codes, the room cap, the idle sweep
// (a box's venue room stays open while a TV shows it), close causes, crash containment
// and debounced players_changed.

import { HostSeats, RoomRegistry, type SessionKind } from "@bargames/gamekit/server";
import type { AdminRoomSummary } from "@buzzboard/shared";
import { defaultBoardId, getAdminSettings } from "../admin/settings.js";
import { MAX_ROOMS, ROOM_SWEEP_INTERVAL_MS } from "../config.js";
import { GameError } from "./errors.js";
import { Room, type RoomTransport } from "./Room.js";

export const IDLE_CLOSE_REASON = "This room was closed after a long period of inactivity.";
export const ADMIN_CLOSE_REASON = "An administrator closed this room.";
export const ERROR_CLOSE_REASON = "Something went wrong and this room had to close.";
/** What everyone sees when the host (or the venue's staff) ends the room. */
export const HOST_CLOSE_REASON = "The host ended this room.";

export type Rooms = RoomRegistry<Room>;

export function createRooms(transport: RoomTransport): Rooms {
  const rooms: Rooms = new RoomRegistry<Room>({
    create: (code, kind, ctx) => {
      const room = new Room(code, transport, kind);
      room.settings.boardId = defaultBoardId();
      // A throw in one room's timer closes only that room.
      room.onFatalError = () => ctx.close(ERROR_CLOSE_REASON, "error");
      // Joins, leaves and kicks (never reconnects).
      room.onPlayersChanged = () => rooms.notePlayers(room);
      return room;
    },
    maxRooms: MAX_ROOMS,
    idleMinutes: () => getAdminSettings().roomIdleMinutes, // read fresh every sweep
    sweepIntervalMs: ROOM_SWEEP_INTERVAL_MS,
    idleReason: IDLE_CLOSE_REASON,
    errorReason: ERROR_CLOSE_REASON,
    fullError: () => new GameError("ROOM_FULL"),
    joinPath: (r) => `/join/${r.code}`,
  });
  return rooms;
}

/**
 * A room nobody's phone created: the box's create_room. It gets an empty host seat
 * (named "Venue") that the host link's key opens (the hostUrl; the kit's HostSeats), so
 * staff can run it from the iPad. With firstJoinerHosts the first phone to join takes
 * that seat instead, until anyone attaches to it (staff's link included).
 */
export function createVenueRoom(
  rooms: Rooms,
  kind: SessionKind = "venue",
  title?: string,
  firstJoinerHosts = false,
): { room: Room; hostToken: string } {
  let hostToken = "";
  const room = rooms.create(kind, (r) => {
    r.title = title?.trim().slice(0, 60) || undefined;
    r.addHost("Venue");
    r.seats = new HostSeats({ firstJoinerHosts });
    hostToken = r.seats.hostToken;
  });
  return { room, hostToken };
}

/** What the /admin room list shows, most recently active first. */
export function listRooms(rooms: Rooms): AdminRoomSummary[] {
  return rooms
    .all()
    .map((r) => r.summary())
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
}
