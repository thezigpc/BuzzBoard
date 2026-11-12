// /admin: sign-in, the room list, settings, and the venue's boards (which persist).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { SAMPLE_BOARDS, boardToCsv } from "@buzzboard/shared";
import { ADMIN_PASSWORD, startServer, setupRoom, tinyBoard, post, sleep } from "../harness.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server.stop());

test("everything needs the password", async () => {
  const st = await (await fetch(`${server.url}/api/admin/status`)).json();
  assert.equal(st.authenticated, false);
  assert.equal(st.setupNeeded, false, "ADMIN_PASSWORD is set");
  for (const [method, route] of [["GET", "/overview"], ["GET", `/boards/${SAMPLE_BOARDS[0].id}`], ["POST", "/boards"], ["PUT", "/settings"], ["DELETE", "/boards/x"], ["POST", "/rooms/ABCD/close"]]) {
    const res = await fetch(`${server.url}/api/admin${route}`, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : "{}" });
    assert.equal(res.status, 401, `${method} ${route}`);
  }
  assert.equal((await post(`${server.url}/api/admin/login`, { password: "wrong" })).status, 401);
  assert.equal((await post(`${server.url}/api/admin/login`, { password: ADMIN_PASSWORD })).status, 200);
});

test("first run without ADMIN_PASSWORD: set it once on the setup screen", async () => {
  const fresh = await startServer({ ADMIN_PASSWORD: "" });
  try {
    assert.equal((await (await fetch(`${fresh.url}/api/admin/status`)).json()).setupNeeded, true);
    const set = await post(`${fresh.url}/api/admin/setup`, { password: "a-long-new-password" });
    assert.equal(set.status, 200);
    assert.ok(existsSync(path.join(fresh.dataDir, "admin.json")));
    assert.notEqual((await post(`${fresh.url}/api/admin/setup`, { password: "someone-else" })).status, 200, "only once");
    assert.equal((await post(`${fresh.url}/api/admin/login`, { password: "a-long-new-password" })).status, 200);
  } finally {
    await fresh.stop();
  }
});

test("rooms: listed with their state, and closed from the admin", async () => {
  const { code, host, players: [ann] } = await setupRoom(server, ["Ann"]);
  await host.ok("startGame");
  const o = await server.admin("GET", "/overview");
  const mine = o.rooms.find((r) => r.code === code);
  assert.deepEqual(
    { kind: mine.kind, phase: mine.phase, round: mine.round, boardTitle: mine.boardTitle, hostConnected: mine.hostConnected, players: mine.players, playersConnected: mine.playersConnected, tables: mine.tables },
    { kind: "patron", phase: "board", round: 1, boardTitle: "Tiny", hostConnected: true, players: 1, playersConnected: 1, tables: 0 },
  );
  assert.equal((await server.admin("POST", `/rooms/${code}/close`)).ok, true);
  await sleep(100);
  assert.match(ann.closedReason, /administrator/i);
  assert.equal((await server.admin("POST", `/rooms/${code}/close`)).status, 404);
});

test("boards: create, read, edit, delete; the samples are read-only", async () => {
  const before = (await server.admin("GET", "/overview")).boards;
  assert.ok(before.filter((b) => b.sample).length === SAMPLE_BOARDS.length);

  const made = await server.admin("POST", "/boards", tinyBoard({ title: "House Trivia" }));
  assert.equal(made.ok, true, made.error);
  const id = made.board.id;
  assert.ok(id && !id.startsWith("sample-"));
  const listed = (await server.admin("GET", "/overview")).boards;
  assert.deepEqual({ ...listed[0], id: undefined }, { id: undefined, title: "House Trivia", rounds: 1, categories: 2, clues: 4, lastCall: true, sample: false }, "the venue's own boards come first");

  const got = await server.admin("GET", `/boards/${id}`);
  assert.equal(got.board.rounds[0].categories[0].clues[0].answer, "Red1 A1");
  const edited = { ...got.board, title: "House Trivia 2", lastCall: null };
  const saved = await server.admin("PUT", `/boards/${id}`, edited);
  assert.equal(saved.board.title, "House Trivia 2");
  assert.equal(saved.board.id, id);
  assert.equal((await server.admin("GET", `/boards/${id}`)).board.lastCall, null);

  // Bad boards come back with a reason a person can act on.
  const bad = await server.admin("POST", "/boards", { ...tinyBoard(), title: "" });
  assert.equal(bad.status, 400);
  assert.match(bad.error, /title/i);
  assert.equal((await server.admin("PUT", "/boards/does-not-exist", tinyBoard())).status, 400);

  // Samples: readable (so the admin can copy one), never changed or deleted.
  const sample = SAMPLE_BOARDS[0];
  assert.equal((await server.admin("GET", `/boards/${sample.id}`)).board.title, sample.title);
  const change = await server.admin("PUT", `/boards/${sample.id}`, { ...sample, title: "Mine now" });
  assert.equal(change.status, 400);
  assert.match(change.error, /copy/i);
  assert.equal((await server.admin("DELETE", `/boards/${sample.id}`)).status, 404);
  // "Make a copy" is a create with the sample's content.
  const copy = await server.admin("POST", "/boards", { ...sample, title: `${sample.title} (copy)` });
  assert.equal(copy.ok, true);
  assert.notEqual(copy.board.id, sample.id);
  assert.deepEqual(copy.board.rounds, sample.rounds);

  assert.equal((await server.admin("DELETE", `/boards/${id}`)).ok, true);
  assert.equal((await server.admin("GET", `/boards/${id}`)).status, 404);
  assert.equal((await server.admin("DELETE", `/boards/${id}`)).status, 404);
});

test("a board imported from a CSV file's text plays in a room", async () => {
  // The admin page parses the file with the shared rules and saves the result.
  const { boardFromFile } = await import("@buzzboard/shared");
  const board = boardFromFile(boardToCsv({ id: "", ...tinyBoard({ title: "From a spreadsheet" }) }), "sheet.csv");
  const saved = await server.admin("POST", "/boards", board);
  assert.equal(saved.ok, true, saved.error);
  const { host } = await setupRoom(server, ["Ann"], { board: null, settings: { boardId: saved.board.id } });
  assert.equal(host.state.boardTitle, "From a spreadsheet");
  await host.ok("startGame");
  assert.deepEqual((await host.waitFor((s) => s.phase === "board")).grid.categories, ["Red1", "Blue1"]);
});

test("a game in progress keeps its board when the admin edits or deletes it", async () => {
  const { host, boardId } = await setupRoom(server, ["Ann"], { board: tinyBoard({ title: "Snapshot" }) });
  await host.ok("startGame");
  const edited = tinyBoard({ title: "Snapshot" });
  edited.rounds[0].categories[0].clues[0] = { clue: "Changed?", answer: "Changed" };
  await server.admin("PUT", `/boards/${boardId}`, edited);
  await host.ok("pickSquare", { cat: 0, row: 0 });
  assert.equal((await host.waitFor((s) => s.clue)).clue.text, "Red1 one?");
  await server.admin("DELETE", `/boards/${boardId}`);
  await host.ok("skipClue");
  await host.ok("continueGame");
  assert.equal((await host.waitFor((s) => s.phase === "board")).boardTitle, "Snapshot");
});

test("settings: the idle time and the board new rooms start on", async () => {
  assert.equal((await server.admin("PUT", "/settings", { roomIdleMinutes: 2 })).status, 400);
  assert.equal((await server.admin("PUT", "/settings", { defaultBoardId: "nope" })).status, 400);
  const first = await server.client();
  await first.ok("createRoom", {});
  const s1 = await first.waitFor((s) => s.phase === "lobby");
  assert.equal(s1.settings.boardId, s1.boards[0].id, "with no choice made: the first board listed");

  const mine = await server.admin("POST", "/boards", tinyBoard({ title: "Tonight's board" }));
  const sample = SAMPLE_BOARDS[1];
  const set = await server.admin("PUT", "/settings", { roomIdleMinutes: 30, defaultBoardId: sample.id });
  assert.deepEqual(set.settings, { roomIdleMinutes: 30, defaultBoardId: sample.id });
  const second = await server.client();
  await second.ok("createRoom", {});
  assert.equal((await second.waitFor((s) => s.phase === "lobby")).boardTitle, sample.title);
  await server.admin("DELETE", `/boards/${mine.board.id}`);
});

test("boards, settings and the password hash survive a restart; a damaged boards file doesn't stop the server", async () => {
  const one = await startServer();
  const made = await one.admin("POST", "/boards", tinyBoard({ title: "Kept" }));
  await one.admin("PUT", "/settings", { defaultBoardId: made.board.id });
  await one.stop({ keepData: true });
  const saved = JSON.parse(readFileSync(path.join(one.dataDir, "boards.json"), "utf8"));
  assert.equal(saved[0].title, "Kept");

  const two = await startServer({ DATA_DIR: one.dataDir });
  try {
    const o = await two.admin("GET", "/overview");
    assert.equal(o.boards[0].title, "Kept");
    assert.equal(o.settings.defaultBoardId, made.board.id);
    const c = await two.client();
    await c.ok("createRoom", {});
    assert.equal((await c.waitFor((s) => s.phase === "lobby")).boardTitle, "Kept");
  } finally {
    await two.stop({ keepData: true });
  }

  const { writeFileSync, rmSync } = await import("node:fs");
  writeFileSync(path.join(one.dataDir, "boards.json"), "{ this is not json");
  const three = await startServer({ DATA_DIR: one.dataDir });
  try {
    const o = await three.admin("GET", "/overview");
    assert.ok(o.boards.every((b) => b.sample), "the samples still load");
    assert.equal(readFileSync(path.join(one.dataDir, "boards.json"), "utf8"), "{ this is not json", "the damaged file is left for a person to fix");
  } finally {
    await three.stop({ keepData: true });
    rmSync(one.dataDir, { recursive: true, force: true });
  }
});
