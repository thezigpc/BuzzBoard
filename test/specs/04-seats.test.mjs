// Seats: joining, teams, reconnecting, leaving and kicking.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, setupRoom, contestantOf, scoreOf } from "../harness.mjs";

let server;
before(async () => (server = await startServer()));
after(async () => server.stop());

test("joining: a name is needed and can't be taken; unknown rooms are refused; room info", async () => {
  const { code, host, players: [ann] } = await setupRoom(server, ["Ann"]);
  const c = await server.client();
  assert.match((await c.emit("joinRoom", { code, role: "player", name: "  " })).error, /name/i);
  assert.match((await c.emit("joinRoom", { code, role: "player", name: "ann" })).error, /already has that name/i);
  assert.match((await c.emit("joinRoom", { code: "ZZZZ", role: "player", name: "Bo" })).error, /doesn't exist/i);
  assert.equal((await c.emit("joinRoom", { code, role: "host", name: "Bo" })).ok, false);
  assert.deepEqual(await c.ok("roomInfo", { code: code.toLowerCase() }), { ok: true, teams: false, teamNames: [], hostOpen: false, phase: "lobby" });
  // A very long name is cut, not refused.
  const joined = await c.ok("joinRoom", { code, role: "player", name: "x".repeat(60) });
  assert.equal(joined.name.length, 24);
  assert.equal(joined.role, "player");
  const s = await host.waitFor((v) => v.contestants.length === 2);
  assert.deepEqual(s.contestants[0].members.map((m) => m.name), ["Ann"]);
  assert.equal(ann.state.you.contestantId, s.contestants[0].id);
});

test("a reload or a dropped connection keeps the seat and the score", async () => {
  const { code, host, players: [ann, bo] } = await setupRoom(server, ["Ann", "Bo"]);
  await host.ok("startGame");
  await host.ok("pickSquare", { cat: 0, row: 1 });
  await host.ok("openBuzzers");
  await ann.ok("buzz");
  await host.ok("judge", { correct: true });
  ann.socket.close();
  let s = await host.waitFor((v) => contestantOf(v, "Ann").connected === false, "Ann shows as offline");
  assert.equal(scoreOf(s, "Ann"), 200);

  const again = await server.client();
  assert.match((await again.emit("resume", { code, token: "not-a-token" })).error, /expired/i);
  const r = await again.ok("resume", { code, token: ann.token });
  assert.deepEqual({ name: r.name, role: r.role, memberId: r.memberId }, { name: "Ann", role: "player", memberId: ann.memberId });
  s = await again.waitFor((v) => v.you.name === "Ann");
  assert.equal(scoreOf(s, "Ann"), 200);
  assert.equal(s.clue.stage, "revealed", "straight back into the clue in play");
  assert.equal(s.pickerId, s.you.contestantId);
  await host.waitFor((v) => contestantOf(v, "Ann").connected === true);
  // Joining again with the seat's token is the same seat, never a second one.
  const third = await server.client();
  const j = await third.ok("joinRoom", { code, role: "player", name: "Someone else", token: bo.token });
  assert.equal(j.memberId, bo.memberId);
  assert.equal((await host.waitFor(() => true)).contestants.length, 2);
});

test("teams: phones share a score, any of them buzzes, and a wrong answer locks the whole team", async () => {
  const { code, host, players: [ann, bo, cy] } = await setupRoom(server, ["Ann", "Bo", "Cy"], { teams: ["Reds", "reds", "Blues"] });
  let s = host.state;
  assert.deepEqual(s.contestants.map((c) => [c.name, c.members.map((m) => m.name)]), [["Reds", ["Ann", "Bo"]], ["Blues", ["Cy"]]]);
  const info = await ann.ok("roomInfo", { code });
  assert.deepEqual({ teams: info.teams, teamNames: info.teamNames }, { teams: true, teamNames: ["Reds", "Blues"] });
  const late = await server.client();
  assert.match((await late.emit("joinRoom", { code, role: "player", name: "Di" })).error, /team/i);

  // In the lobby a player can switch teams; an emptied team disappears.
  await cy.ok("setTeam", { team: "Greens" });
  s = await host.waitFor((v) => v.contestants.some((c) => c.name === "Greens"));
  assert.deepEqual(s.contestants.map((c) => c.name), ["Reds", "Greens"]);

  await host.ok("startGame");
  assert.equal((await cy.emit("setTeam", { team: "Reds" })).ok, false, "teams are fixed once the game starts");
  await host.ok("pickSquare", { cat: 0, row: 0 });
  await host.ok("openBuzzers");
  assert.equal((await bo.ok("buzz")).result, "first");
  s = await host.waitFor((v) => v.clue?.stage === "answering");
  assert.equal(s.clue.buzzedName, "Bo", "the TV says whose phone it was");
  assert.equal(s.clue.buzzedBy, contestantOf(s, "Ann").id);
  await host.ok("judge", { correct: false });
  assert.equal((await ann.ok("buzz")).result, "locked", "her teammate already answered wrong");
  assert.equal((await cy.ok("buzz")).result, "first");
  await host.ok("judge", { correct: true });
  s = await host.waitFor((v) => v.clue?.stage === "revealed");
  assert.deepEqual(s.contestants.map((c) => [c.name, c.score]), [["Reds", -100], ["Greens", 100]]);

  // Last Call: either phone on a team sets the wager and the answer.
  await host.ok("continueGame");
  await host.ok("nextRound");
  await ann.ok("lastCallWager", { amount: 100 });
  await bo.ok("lastCallWager", { amount: 250 });
  assert.equal((await ann.waitFor((v) => v.lastCall?.mine?.wager === 250, "a teammate's wager shows on both phones")).lastCall.mine.wager, 250);
  await host.ok("lastCallAdvance");
  await ann.ok("lastCallAnswer", { text: "first idea" });
  await bo.ok("lastCallAnswer", { text: "better idea" });
  assert.equal((await ann.waitFor((v) => v.lastCall?.mine?.answer === "better idea")).lastCall.mine.answer, "better idea");
});

test("teams turned off in the lobby: everyone scores alone again", async () => {
  const { host } = await setupRoom(server, ["Ann", "Bo", "Cy"], { teams: ["Reds", "Reds", "Blues"] });
  await host.ok("updateSettings", { teams: false });
  const s = await host.waitFor((v) => v.contestants.length === 3);
  assert.deepEqual(s.contestants.map((c) => [c.name, c.members.map((m) => m.name)]), [["Ann", ["Ann"]], ["Cy", ["Cy"]], ["Bo", ["Bo"]]]);
});

test("leaving and kicking: the seat goes, the game carries on", async () => {
  const { code, host, players: [ann, bo, cy] } = await setupRoom(server, ["Ann", "Bo", "Cy"]);
  await host.ok("startGame");
  let s = await host.waitFor((v) => v.phase === "board");
  assert.equal(s.pickerId, contestantOf(s, "Ann").id);
  assert.equal((await bo.emit("kickPlayer", ann.memberId)).ok, false, "only the host removes people");
  await host.ok("kickPlayer", ann.memberId);
  assert.match(ann.closedReason, /removed you/i);
  s = await host.waitFor((v) => v.contestants.length === 2);
  assert.equal(s.pickerId, contestantOf(s, "Bo").id, "control passes on when the one holding it leaves");

  // The player answering leaves: the clue ends with nobody scoring.
  await host.ok("pickSquare", { cat: 0, row: 0 });
  await host.ok("openBuzzers");
  await bo.ok("buzz");
  await bo.ok("leaveRoom");
  s = await host.waitFor((v) => v.clue?.stage === "revealed");
  assert.equal(s.clue.winnerId, null);
  assert.deepEqual(s.contestants.map((c) => c.name), ["Cy"]);
  assert.equal((await bo.emit("buzz")).ok, false);

  // The host leaving ends the room for everyone.
  await host.ok("leaveRoom");
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(cy.closedReason, "The host ended this room.");
  const c = await server.client();
  assert.equal((await c.emit("roomInfo", { code })).ok, false);
});

test("the TV: joins with just the code, sees no answers, and can't run anything", async () => {
  const { code, host } = await setupRoom(server, ["Ann"]);
  const tv = await server.client();
  const j = await tv.ok("joinRoom", { code, role: "table" });
  assert.equal(j.role, "table");
  const s = await host.waitFor((v) => v.tableCount === 1);
  assert.equal(s.contestants.length, 1, "a screen is not a player");
  for (const [ev, arg] of [["startGame"], ["openBuzzers"], ["judge", { correct: true }], ["pickSquare", { cat: 0, row: 0 }], ["closeRoom"], ["updateSettings", { teams: true }]]) {
    const res = arg ? await tv.emit(ev, arg) : await tv.emit(ev);
    assert.equal(res.ok, false, ev);
  }
});
