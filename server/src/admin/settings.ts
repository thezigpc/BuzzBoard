import { createSettingStore } from "@bargames/gamekit/server";
import { ADMIN_SETTINGS_LIMITS, type AdminSettings } from "@buzzboard/shared";
import { getBoard, listBoards } from "../boards.js";
import { DEFAULT_ROOM_IDLE_MINUTES, store } from "../config.js";

// Admin settings in DATA_DIR/settings.json (the kit's setting store: atomic writes, and
// a damaged file is left untouched while the defaults apply).
const settings = createSettingStore<AdminSettings>({
  store,
  file: "settings.json",
  defaults: { roomIdleMinutes: DEFAULT_ROOM_IDLE_MINUTES, defaultBoardId: "" },
  normalize: clean,
});

export const initAdminSettings = () => settings.init();
export const getAdminSettings = (): AdminSettings => settings.get();

/** The board a new room starts on: the admin's choice while it exists, else the first listed. */
export function defaultBoardId(): string {
  const chosen = getAdminSettings().defaultBoardId;
  return chosen && getBoard(chosen) ? chosen : (listBoards()[0]?.id ?? "");
}

const idleOk = (n: number) =>
  Number.isFinite(n) && n >= ADMIN_SETTINGS_LIMITS.roomIdleMinutes.min && n <= ADMIN_SETTINGS_LIMITS.roomIdleMinutes.max;

function clean(s: AdminSettings): AdminSettings {
  const n = Math.round(Number(s.roomIdleMinutes));
  return {
    roomIdleMinutes: idleOk(n) ? n : DEFAULT_ROOM_IDLE_MINUTES,
    defaultBoardId: typeof s.defaultBoardId === "string" ? s.defaultBoardId.slice(0, 64) : "",
  };
}

/** Validates only the fields being changed (a readable error if one is bad), then saves. */
export async function updateAdminSettings(patch: Partial<AdminSettings>): Promise<AdminSettings> {
  const out: Partial<AdminSettings> = {};
  if (patch.roomIdleMinutes !== undefined) {
    const { min, max } = ADMIN_SETTINGS_LIMITS.roomIdleMinutes;
    const n = Math.round(Number(patch.roomIdleMinutes));
    if (!idleOk(n)) throw new Error(`Idle time must be between ${min} and ${max} minutes.`);
    out.roomIdleMinutes = n;
  }
  if (patch.defaultBoardId !== undefined) {
    const id = String(patch.defaultBoardId);
    if (id && !getBoard(id)) throw new Error("That board no longer exists.");
    out.defaultBoardId = id;
  }
  return settings.set(out);
}
