import { createSessionStore } from "@bargames/gamekit/client";
import type { Role } from "@buzzboard/shared";

export interface StoredSession {
  roomCode: string;
  token: string;
  name: string;
  role: Role;
  /** Set by /join/CODE?host=<key>: `token` is the host link's key until the first resume. */
  hostLink?: boolean;
}

// The kit's session store. Every key starts with "buzzboard_" (all the venue's games
// share one origin). The seat is per tab, kept in localStorage so it survives a phone
// evicting a backgrounded tab; storage errors (private mode) never throw.
export const sessions = createSessionStore<StoredSession>("buzzboard");

export const loadSession = (): StoredSession | null => sessions.load();
export const saveSession = (s: StoredSession): void => sessions.save(s);
export const clearSession = (): void => sessions.clear();

/** Last name and team typed on this device, to prefill the join form. */
export const lastName = (): string => sessions.pref("last_name");
export const rememberName = (name: string): void => sessions.setPref("last_name", name);
export const lastTeam = (): string => sessions.pref("last_team");
export const rememberTeam = (team: string): void => sessions.setPref("last_team", team);
