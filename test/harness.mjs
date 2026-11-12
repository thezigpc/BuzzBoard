// Test harness: every spec file gets its own throwaway server on its own port.
// Specs talk to it over real sockets, exactly like the client does.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import net from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import { io } from "socket.io-client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ADMIN_PASSWORD = "test-admin-password";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

export async function startServer(env = {}) {
  const port = await freePort();
  // Throwaway data dir per server: admin password, settings and boards never leak between specs.
  const dataDir = env.DATA_DIR ?? mkdtempSync(path.join(os.tmpdir(), "buzzboard-test-"));
  const proc = spawn(process.execPath, [path.join(root, "server/dist/index.js")], {
    env: {
      ...process.env,
      PORT: String(port),
      LOG_LEVEL: "warn",
      CLIENT_DIST_PATH: path.join(root, "nonexistent"),
      ADMIN_PASSWORD,
      GAME_NAME: "",
      ...env,
      DATA_DIR: dataDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  proc.stdout.on("data", (d) => (output += d));
  proc.stderr.on("data", (d) => (output += d));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/health`);
      if (res.ok) break;
    } catch {}
    await sleep(100);
  }
  const clients = [];
  let token;
  const server = {
    url,
    dataDir,
    proc,
    port,
    get output() {
      return output;
    },
    async client(opts) {
      const c = await connect(url, opts);
      clients.push(c);
      return c;
    },
    /** An admin API call, signed in with the test password. */
    async admin(method, route, body) {
      token ??= (await (await post(`${url}/api/admin/login`, { password: ADMIN_PASSWORD })).json()).token;
      const res = await fetch(`${url}/api/admin${route}`, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, ...(await res.json().catch(() => ({}))) };
    },
    async stop({ keepData = false } = {}) {
      for (const c of clients) c.socket.close();
      proc.kill();
      await new Promise((r) => proc.once("exit", r));
      if (!keepData) rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return server;
}

export const post = (url, body, headers = {}) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

/** A socket wrapper that remembers the latest state and lets specs await conditions. */
export async function connect(url, opts = {}) {
  const socket = io(url, { transports: ["websocket"], reconnection: false, forceNew: true, ...opts });
  const c = {
    socket,
    state: null,
    /** Every state received, with the local time it arrived. */
    states: [],
    closedReason: null,
    waiters: [],
    emit(event, ...args) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 5000);
        socket.emit(event, ...args, (res) => {
          clearTimeout(t);
          resolve(res);
        });
      });
    },
    /** Emits and asserts ok, returning the ack payload. */
    async ok(event, ...args) {
      const res = await c.emit(event, ...args);
      if (!res?.ok) throw new Error(`${event} failed: ${res?.error}`);
      return res;
    },
    waitFor(pred, label = "condition", ms = 5000) {
      if (c.state && pred(c.state)) return Promise.resolve(c.state);
      return new Promise((resolve, reject) => {
        const w = { pred, resolve };
        c.waiters.push(w);
        setTimeout(() => {
          c.waiters = c.waiters.filter((x) => x !== w);
          reject(new Error(`timed out waiting for ${label}; last state: ${JSON.stringify(c.state)?.slice(0, 600)}`));
        }, ms);
      });
    },
  };
  socket.on("state", (s) => {
    c.state = s;
    c.states.push({ at: performance.now(), s });
    for (const w of [...c.waiters]) {
      if (w.pred(s)) {
        c.waiters = c.waiters.filter((x) => x !== w);
        w.resolve(s);
      }
    }
  });
  socket.on("closed", ({ reason }) => (c.closedReason = reason));
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return c;
}

/**
 * A small board for specs: two categories with two clues each (rows 1 and 2), and a
 * Last Call. `rounds: 2` adds a second, identical round.
 */
export function tinyBoard({ rounds = 1, lastCall = true, title = "Tiny" } = {}) {
  const blank = { clue: "", answer: "" };
  const cat = (name) => ({
    name,
    clues: [{ clue: `${name} one?`, answer: `${name} A1` }, { clue: `${name} two?`, answer: `${name} A2` }, blank, blank, blank],
  });
  return {
    title,
    rounds: Array.from({ length: rounds }, (_, i) => ({ categories: [cat(`Red${i + 1}`), cat(`Blue${i + 1}`)] })),
    lastCall: lastCall ? { category: "Finale", clue: "The last clue?", answer: "The last answer" } : null,
  };
}

/** Host + N players in one room, on a tiny board with no Double Downs unless asked. */
export async function setupRoom(server, playerNames = ["Ann"], { board = tinyBoard(), settings = {}, teams } = {}) {
  const host = await server.client();
  const created = await host.ok("createRoom", { name: "Host" });
  let boardId;
  if (board) {
    const saved = await server.admin("POST", "/boards", board);
    if (!saved.ok) throw new Error(`board not saved: ${saved.error}`);
    boardId = saved.board.id;
  }
  await host.ok("updateSettings", { doubleDowns: 0, ...(boardId ? { boardId } : {}), ...(teams ? { teams: true } : {}), ...settings });
  const players = [];
  for (const [i, name] of playerNames.entries()) {
    const p = await server.client();
    const joined = await p.ok("joinRoom", { code: created.code, role: "player", name, team: teams?.[i] });
    p.token = joined.token;
    p.memberId = joined.memberId;
    p.name = name;
    players.push(p);
  }
  await host.waitFor((s) => s.contestants.flatMap((c) => c.members).length === playerNames.length, "everyone seated");
  return { code: created.code, host, players, boardId };
}

/** The contestant a player scores for, from any client's latest state. */
export const contestantOf = (state, name) => state.contestants.find((c) => c.members.some((m) => m.name === name));
export const scoreOf = (state, name) => contestantOf(state, name)?.score;
