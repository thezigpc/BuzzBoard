import { adminRouter as kitAdminRouter, createAdminAuth, log } from "@bargames/gamekit/server";
import type express from "express";
import type { AdminOverview, AdminSettings } from "@buzzboard/shared";
import { deleteBoard, getBoard, listBoards, saveBoard } from "../boards.js";
import { ADMIN_PASSWORD, store } from "../config.js";
import { ADMIN_CLOSE_REASON, listRooms, type Rooms } from "../rooms/registry.js";
import { bg, clientIp, onBox } from "../bargames.js";
import { getAdminSettings, updateAdminSettings } from "./settings.js";

/**
 * The admin password (the kit's admin auth): the ADMIN_PASSWORD env var, or a scrypt hash
 * chosen once on the /admin setup screen and kept in DATA_DIR/admin.json. On a Bar Games
 * box the box's own admin password signs in too, and takes over first-run setup.
 */
export const adminAuth = createAdminAuth({
  store,
  envPassword: ADMIN_PASSWORD,
  // Standalone behind a tunnel a whole venue's Wi-Fi shares one public IP, so a per-IP
  // lockout would let any guest lock the real admin out; the kit's global cap and capped
  // delay still slow guessing. On a box each device has its own address.
  failsAllowed: onBox ? undefined : Infinity,
  venuePassword: (password, ip) => bg.checkVenuePassword(password, ip),
  onBox: bg.connected,
});

const message = (err: unknown) => (err instanceof Error ? err.message : "Couldn't save.");

/** /api/admin/*: the kit's status, setup, login and logout, then rooms, settings and boards. */
export function adminRouter(rooms: Rooms): express.Router {
  // Staff signed in to the venue box open this page without the password. isStaff is true
  // only through the box's gateway; always false standalone.
  const r = kitAdminRouter({ auth: adminAuth, clientIp, trusted: (req) => bg.isStaff(req) });

  // Everything below needs a signed-in admin (the kit's router checks it).
  r.get("/overview", (_req, res) => {
    const body: AdminOverview = {
      rooms: listRooms(rooms),
      settings: getAdminSettings(),
      boards: listBoards(),
      serverTime: Date.now(),
    };
    res.json(body);
  });

  r.post("/rooms/:code/close", (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const ok = rooms.closeRoom(code, ADMIN_CLOSE_REASON, "admin");
    log.info("admin", "closed room", { code, ok });
    res.status(ok ? 200 : 404).json(ok ? { ok: true } : { ok: false, error: "That room is already gone." });
  });

  r.put("/settings", async (req, res) => {
    try {
      const settings = await updateAdminSettings((req.body ?? {}) as Partial<AdminSettings>);
      log.info("admin", "settings updated", { roomIdleMinutes: settings.roomIdleMinutes });
      rooms.sweepIdle(); // a shorter idle time applies right away
      res.json({ ok: true, settings });
    } catch (err) {
      res.status(400).json({ ok: false, error: message(err) });
    }
  });

  // Boards: a whole board (answers included) only ever leaves through these routes.
  r.get("/boards/:id", (req, res) => {
    const board = getBoard(String(req.params.id));
    if (!board) return void res.status(404).json({ ok: false, error: "That board no longer exists." });
    res.json({ ok: true, board });
  });
  r.post("/boards", async (req, res) => {
    try {
      const board = await saveBoard(req.body);
      log.info("admin", "board created", { id: board.id, title: board.title });
      res.json({ ok: true, board });
    } catch (err) {
      res.status(400).json({ ok: false, error: message(err) });
    }
  });
  r.put("/boards/:id", async (req, res) => {
    try {
      const board = await saveBoard(req.body, String(req.params.id));
      log.info("admin", "board saved", { id: board.id, title: board.title });
      res.json({ ok: true, board });
    } catch (err) {
      res.status(400).json({ ok: false, error: message(err) });
    }
  });
  r.delete("/boards/:id", async (req, res) => {
    const ok = await deleteBoard(String(req.params.id));
    log.info("admin", "board deleted", { id: req.params.id, ok });
    res.status(ok ? 200 : 404).json(ok ? { ok: true } : { ok: false, error: "That board can't be deleted." });
  });

  return r;
}
