import { useEffect, useState, type FormEvent } from "react";
import { basePath } from "@bargames/gamekit/client";
import { joinUrl as venueJoinUrl } from "@bargames/sdk/client";
import { MIN_WAGER, SETTINGS_LIMITS, type RoomSettings, type RoomView } from "@buzzboard/shared";
import { Address, BoardGrid, QrCode, Scores, TimerBar, contestant, joinInfo, nameOf, nextUp, pts, roundLabel, shortUrl, standings } from "../components/bits";
import { TvsPanel } from "../components/TvsPanel";
import { useVenue } from "../useVenue";
import type { Act } from "./RoomPage";

interface Props {
  view: RoomView;
  skew: number;
  act: Act;
}

/**
 * The host's screen (a phone or the staff iPad): everything that runs the game, and the
 * answers. A co-host sees the same, less ending the room and removing people.
 */
export function HostView({ view, skew, act }: Props) {
  const isHost = view.you.role === "host";
  return (
    <main className="host">
      {view.phase === "lobby" && <Lobby view={view} act={act} />}
      {view.phase === "board" && <BoardPhase view={view} act={act} />}
      {view.phase === "clue" && view.clue && <CluePhase view={view} skew={skew} act={act} />}
      {view.phase === "roundEnd" && <RoundEnd view={view} act={act} />}
      {view.phase === "lastCall" && view.lastCall && <LastCall view={view} skew={skew} act={act} />}
      {view.phase === "final" && <Final view={view} act={act} />}
      {view.phase !== "lobby" && <ScorePanel view={view} act={act} />}
      {view.phase !== "lobby" && view.phase !== "final" && (
        <details className="panel quiet">
          <summary>More</summary>
          <GameOptions view={view} act={act} />
          <div className="row">
            <button className="btn btn-ghost" onClick={() => window.confirm("Stop this game and go back to the setup screen? Scores are cleared.") && act("playAgain")}>
              Start over
            </button>
            {isHost && (
              <button className="btn btn-danger" onClick={() => window.confirm("End this room for everyone?") && act("closeRoom")}>
                End the room
              </button>
            )}
          </div>
        </details>
      )}
      {view.phase !== "lobby" && isHost && <CohostsPanel view={view} act={act} />}
    </main>
  );
}

// ---------------------------------------------------------------- lobby

function Lobby({ view, act }: Omit<Props, "skew">) {
  const venue = useVenue();
  const join = joinInfo(view.code, venue);
  const url = join.url;
  const tvUrl = `${window.location.origin}${basePath()}/room/${view.code}?role=table`;
  const set = (patch: Partial<RoomSettings>) => act("updateSettings", patch);
  const board = view.boards.find((b) => b.id === view.settings.boardId);
  const players = view.contestants.flatMap((c) => c.members.map((m) => ({ ...m, team: c.name })));

  return (
    <>
      <section className="panel join-card">
        <div>
          <h2>Players join here</h2>
          <p className="join-code">{view.code}</p>
          <p className="muted small join-address">
            <Address shown={join.shown} align="start" />
          </p>
        </div>
        <QrCode text={url} size={132} />
      </section>

      <section className="panel">
        <h2>The game</h2>
        <label>
          Board
          <select aria-label="Board" value={view.settings.boardId} onChange={(e) => set({ boardId: e.target.value })}>
            {view.boards.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
                {b.sample ? " (sample)" : ""}
              </option>
            ))}
          </select>
        </label>
        {board && (
          <p className="muted small">
            {board.rounds === 1 ? "1 round" : `${board.rounds} rounds`}, {board.clues} clues{board.lastCall ? ", and a Last Call" : ", no Last Call"}.
          </p>
        )}
        <div className="seg" role="group" aria-label="Teams or solo">
          <button className={view.settings.teams ? "" : "on"} onClick={() => set({ teams: false })}>
            Everyone for themselves
          </button>
          <button className={view.settings.teams ? "on" : ""} onClick={() => set({ teams: true })}>
            Teams
          </button>
        </div>
        <p className="muted small">
          {view.settings.teams
            ? "Players pick or name a team when they join. Any phone on a team can buzz, and the team shares one score."
            : "Every phone keeps its own score."}
        </p>
        <details>
          <summary>Rules</summary>
          <GameOptions view={view} act={act} lobby />
        </details>
      </section>

      <section className="panel">
        <h2>
          {view.settings.teams ? "Teams" : "Players"} <span className="muted">({view.settings.teams ? view.contestants.length : players.length})</span>
        </h2>
        {players.length === 0 && <p className="muted">Nobody has joined yet. Share the code or the QR.</p>}
        {view.settings.teams ? (
          view.contestants.map((c) => (
            <div key={c.id} className="team">
              <strong>{c.name}</strong>
              <People list={c.members} act={act} canRemove={view.you.role === "host"} />
            </div>
          ))
        ) : (
          <People list={players} act={act} canRemove={view.you.role === "host"} />
        )}
        <button className="btn btn-primary btn-big" disabled={view.contestants.length === 0} onClick={() => act("startGame")}>
          Start the game
        </button>
      </section>

      <section className="panel">
        <h2>The big screen</h2>
        <p className="muted small">
          Open this link on the TV's browser, or on a laptop plugged into it. It shows the board, the clue and the scores, never the answers.
          {view.tableCount > 0 && ` ${view.tableCount} screen${view.tableCount === 1 ? " is" : "s are"} connected.`}
        </p>
        <a className="btn btn-ghost" href={tvUrl} target="_blank" rel="noopener noreferrer">
          Open the TV screen
        </a>
        <p className="muted small break">{shortUrl(tvUrl)}</p>
      </section>
      {view.you.role === "host" && <CohostsPanel view={view} act={act} />}
      <TvsPanel code={view.code} />
    </>
  );
}

function People({ list, act, canRemove }: { list: { id: string; name: string; connected: boolean }[]; act: Act; canRemove: boolean }) {
  return (
    <ul className="people">
      {list.map((p) => (
        <li key={p.id} className={p.connected ? "" : "away"}>
          <span>{p.name}</span>
          {canRemove && (
            <button className="icon-btn small" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => window.confirm(`Remove ${p.name} from the room?`) && act("kickPlayer", p.id)}>
              ✕
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Co-hosts (0.2.0, the kit's HostSeats): a QR of a single-use invite that expires, and the
 * co-host list. A co-host runs the game but can't end the room or remove anyone. Host only.
 */
function CohostsPanel({ view, act }: { view: RoomView; act: Act }) {
  const venue = useVenue();
  const [invite, setInvite] = useState<{ url: string; expiresAt: string; count: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const count = view.cohosts.length;
  const expired = invite ? Date.parse(invite.expiresAt) <= now : false;
  useEffect(() => {
    if (!invite) return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [invite]);
  // Someone joined as a co-host: the code works only once, so put it away.
  useEffect(() => {
    if (invite && count > invite.count) setInvite(null);
  }, [count, invite]);
  const add = async () => {
    const res = await act<{ path: string; expiresAt: string }>("cohostInvite");
    if (!res) return;
    setNow(Date.now());
    setInvite({ url: venueJoinUrl(venue, res.path), expiresAt: res.expiresAt, count });
  };
  const until = invite ? new Date(invite.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  return (
    <section className="panel cohosts">
      <h2>
        Co-hosts <span className="muted">({count})</span>
      </h2>
      <p className="muted small">
        A co-host runs the game with you (picks squares, opens the buzzers, judges, keeps score) but can't end the room or remove anyone.
      </p>
      {invite && !expired ? (
        <div className="invite-row">
          <QrCode text={invite.url} size={160} />
          <div>
            <p>Scan with the co-host's phone.</p>
            <p className="muted small">Works once, until {until}.</p>
            <button className="btn btn-ghost btn-small" onClick={() => setInvite(null)}>
              Hide
            </button>
          </div>
        </div>
      ) : (
        <button className="btn btn-secondary" onClick={add}>
          {expired ? "That invite expired: make a new one" : "Add a co-host"}
        </button>
      )}
      {count > 0 && (
        <ul className="people">
          {view.cohosts.map((c) => (
            <li key={c.id} className={c.connected ? "" : "away"}>
              <span>
                {c.name} <span className="badge">Co-host</span>
              </span>
              <button
                className="btn btn-ghost btn-small"
                onClick={() => window.confirm(`Make ${c.name} a player again? They lose the host controls.`) && act("removeCohost", c.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The room's rules. Those that shape the game can only change in the lobby. */
function GameOptions({ view, act, lobby = false }: { view: RoomView; act: Act; lobby?: boolean }) {
  const s = view.settings;
  const set = (patch: Partial<RoomSettings>) => act("updateSettings", patch);
  const num = (key: "buzzSeconds" | "earlyPenaltyMs" | "lastCallSeconds" | "doubleDowns", label: string, unit: string) => (
    <label className="inline">
      <span>{label}</span>
      <span className="with-unit">
        <input
          // Text with a number pad, not type="number": the kit's keyboard can't edit those.
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={String(SETTINGS_LIMITS[key].max).length}
          onChange={(e) => (e.target.value = e.target.value.replace(/\D/g, ""))}
          defaultValue={s[key]}
          key={s[key]}
          onBlur={(e) => Number(e.target.value) !== s[key] && e.target.value !== "" && set({ [key]: Number(e.target.value) })}
        />
        {unit}
      </span>
    </label>
  );
  const flag = (key: "wrongCosts" | "playersPick" | "doubleLater" | "lastCall", label: string) => (
    <label className="switch">
      <input type="checkbox" checked={s[key]} onChange={(e) => set({ [key]: e.target.checked })} />
      {label}
    </label>
  );
  return (
    <div className="options">
      {num("buzzSeconds", "Time to buzz in", "seconds")}
      {num("earlyPenaltyMs", "Lockout for buzzing too early", "ms")}
      {flag("wrongCosts", "A wrong answer takes the points off")}
      {flag("playersPick", "The player in control picks the next square on their phone")}
      {lobby && num("doubleDowns", "Double Down squares per round", "")}
      {lobby && view.roundCount > 1 && flag("doubleLater", "Round 2 is worth double")}
      {lobby && flag("lastCall", "Finish with Last Call (if the board has one)")}
      {(lobby ? s.lastCall : view.hasLastCall) && num("lastCallSeconds", "Time to answer Last Call", "seconds")}
    </div>
  );
}

// ------------------------------------------------------------ the board

function BoardPhase({ view, act }: Omit<Props, "skew">) {
  const left = view.grid!.cells.flat().filter((c) => c === "open").length;
  const next = nextUp(view);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{roundLabel(view)}</h2>
        <span className="muted small">{view.boardTitle}</span>
      </div>
      <label className="inline">
        <span>In control</span>
        <select value={view.pickerId ?? ""} onChange={(e) => e.target.value && act("setPicker", { contestantId: e.target.value })}>
          {!view.pickerId && <option value="">Nobody</option>}
          {view.contestants.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small">
        {view.settings.playersPick ? "They can pick on their phone, or tap a square here for them." : "Ask them for a category and value, then tap the square."}
      </p>
      <BoardGrid grid={view.grid!} onPick={(cat, row) => act("pickSquare", { cat, row })} />
      <button
        className="btn btn-ghost"
        onClick={() => window.confirm(`Skip the ${left} square${left === 1 ? "" : "s"} left and go to ${next}?`) && act("nextRound")}
      >
        Skip to {next}
      </button>
    </section>
  );
}

function CluePhase({ view, skew, act }: Props) {
  const clue = view.clue!;
  const who = contestant(view, clue.buzzedBy);
  const [wager, setWager] = useState("");
  const submitWager = (e: FormEvent) => {
    e.preventDefault();
    act("setWager", { amount: Number(wager) }).then((ok) => ok && setWager(""));
  };
  return (
    <section className={`panel clue-panel stage-${clue.stage}`}>
      <div className="panel-head">
        <h2>
          {clue.category} <span className="value">{pts(clue.value)}</span>
        </h2>
        {clue.doubleDown && <span className="tag hot">Double Down</span>}
      </div>
      <p className="clue-text">{clue.text}</p>
      <p className="answer">
        <span className="muted small">Answer</span>
        {clue.answer}
      </p>

      {clue.stage === "wager" && (
        <>
          <p className="status">
            <strong>{who?.name}</strong> picked a Double Down. Only they answer. Don't read the clue yet: they wager first, from {MIN_WAGER} up to{" "}
            {pts(clue.wagerMax)}, on their phone.
          </p>
          <form className="row" onSubmit={submitWager}>
            <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={7} value={wager} onChange={(e) => setWager(e.target.value.replace(/\D/g, ""))} placeholder="Or type their wager" aria-label="Wager" />
            <button className="btn btn-secondary" disabled={wager === ""}>
              Set wager
            </button>
          </form>
          <button className="btn btn-ghost" onClick={() => act("cancelClue")}>
            Put the square back
          </button>
        </>
      )}

      {clue.stage === "reading" && (
        <>
          <p className="status">Read the clue out loud, then open the buzzers.</p>
          <button className="btn btn-primary btn-huge" onClick={() => act("openBuzzers")}>
            Open the buzzers
          </button>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => act("cancelClue")}>
              Put the square back
            </button>
            <button className="btn btn-ghost" onClick={() => act("skipClue")}>
              Show the answer
            </button>
          </div>
        </>
      )}

      {clue.stage === "open" && (
        <>
          <p className="status live">Buzzers are open</p>
          <TimerBar deadline={clue.deadline} totalSeconds={view.settings.buzzSeconds} skew={skew} />
          {clue.lockedOut.length > 0 && <p className="muted small">Already wrong: {clue.lockedOut.map((id) => nameOf(view, id)).join(", ")}</p>}
          <button className="btn btn-ghost" onClick={() => act("skipClue")}>
            Nobody knows: show the answer
          </button>
        </>
      )}

      {clue.stage === "answering" && (
        <>
          <p className="status buzzed">
            <strong>{clue.doubleDown ? who?.name : clue.buzzedName}</strong>
            {!clue.doubleDown && who && who.name !== clue.buzzedName && <span className="muted"> for {who.name}</span>}
            {clue.doubleDown ? ` wagered ${pts(clue.wager ?? 0)}. Read the clue.` : " buzzed in"}
          </p>
          {!clue.doubleDown && clue.buzzes.length > 0 && (
            <p className="muted small">
              {clue.buzzes.map((b, i) => `${b.name} ${(b.ms / 1000).toFixed(3)} s${i === 0 ? "" : " (too late)"}`).join(" · ")}
            </p>
          )}
          <div className="judge">
            <button className="btn btn-good btn-huge" onClick={() => act("judge", { correct: true })}>
              ✓ Right
            </button>
            <button className="btn btn-bad btn-huge" onClick={() => act("judge", { correct: false })}>
              ✗ Wrong
            </button>
          </div>
          <button className="btn btn-ghost" onClick={() => act("skipClue")}>
            No score: show the answer
          </button>
        </>
      )}

      {clue.stage === "revealed" && (
        <>
          <p className="status">{clue.winnerId ? `${nameOf(view, clue.winnerId)} got it and picks next.` : "Nobody got it."}</p>
          <button className="btn btn-primary btn-huge" onClick={() => act("continueGame")}>
            Back to the board
          </button>
        </>
      )}
    </section>
  );
}

function RoundEnd({ view, act }: Omit<Props, "skew">) {
  return (
    <section className="panel">
      <h2>{roundLabel(view)} is done</h2>
      <p className="muted">The scores are on the screen.</p>
      <button className="btn btn-primary btn-huge" onClick={() => act("nextRound")}>
        On to {nextUp(view)}
      </button>
    </section>
  );
}

// ------------------------------------------------------------ Last Call

function LastCall({ view, skew, act }: Props) {
  const lc = view.lastCall!;
  const current = lc.entries.find((e) => e.contestantId === lc.revealing);
  const left = lc.entries.filter((e) => e.correct === null).length;
  const waiting = (done: (e: (typeof lc.entries)[number]) => boolean) => lc.entries.filter((e) => !done(e)).map((e) => nameOf(view, e.contestantId));
  return (
    <section className="panel clue-panel">
      <div className="panel-head">
        <h2>Last Call</h2>
        <span className="tag">{lc.category}</span>
      </div>
      <p className="clue-text">{lc.text}</p>
      <p className="answer">
        <span className="muted small">Answer</span>
        {lc.answer}
      </p>

      {lc.stage === "wager" && (
        <>
          <p className="status">Announce the category. Everyone wagers in secret on their phone. Don't read the clue yet.</p>
          <p className="muted small">
            {waiting((e) => e.wagered).length === 0 ? "All wagers are in." : `Still to wager: ${waiting((e) => e.wagered).join(", ")}. Anyone who doesn't wagers 0.`}
          </p>
          <button className="btn btn-primary btn-huge" onClick={() => act("lastCallAdvance")}>
            Show the clue
          </button>
        </>
      )}

      {lc.stage === "answer" && (
        <>
          <p className="status live">Read the clue. Everyone types an answer.</p>
          <TimerBar deadline={lc.deadline} totalSeconds={view.settings.lastCallSeconds} skew={skew} />
          <p className="muted small">{waiting((e) => e.answered).length === 0 ? "All answers are in." : `Still thinking: ${waiting((e) => e.answered).join(", ")}`}</p>
          <button className="btn btn-secondary" onClick={() => act("lastCallAdvance")}>
            Lock the answers now
          </button>
        </>
      )}

      {lc.stage === "reveal" && (
        <>
          {current && current.correct === null ? (
            <>
              <p className="status buzzed">
                <strong>{nameOf(view, current.contestantId)}</strong> wrote: <q>{current.answer || "(nothing)"}</q>
              </p>
              <div className="judge">
                <button className="btn btn-good btn-huge" onClick={() => act("lastCallJudge", { correct: true })}>
                  ✓ Right
                </button>
                <button className="btn btn-bad btn-huge" onClick={() => act("lastCallJudge", { correct: false })}>
                  ✗ Wrong
                </button>
              </div>
            </>
          ) : (
            <>
              {current && (
                <p className="status">
                  {nameOf(view, current.contestantId)} wagered {pts(current.wager ?? 0)} and {current.correct ? "wins" : "loses"} it.
                </p>
              )}
              <button className="btn btn-primary btn-huge" onClick={() => act("lastCallAdvance")}>
                {left > 0 ? (current ? "Reveal the next answer" : "Reveal the first answer") : "Show the winner"}
              </button>
              {left > 0 && <p className="muted small">Answers are shown from the lowest score up. {left} to go.</p>}
            </>
          )}
        </>
      )}
    </section>
  );
}

function Final({ view, act }: Omit<Props, "skew">) {
  const names = view.winners.map((id) => nameOf(view, id));
  return (
    <section className="panel">
      <h2>{names.length > 1 ? "It's a tie!" : "We have a winner"}</h2>
      <p className="winner-name">{names.join(" & ") || "Nobody"}</p>
      {view.lastCall?.answer && (
        <p className="muted small">
          Last Call answer: {view.lastCall.answer}
        </p>
      )}
      <div className="row">
        <button className="btn btn-primary" onClick={() => act("playAgain")}>
          Play again
        </button>
        {view.you.role === "host" && (
          <button className="btn btn-ghost" onClick={() => window.confirm("End this room for everyone?") && act("closeRoom")}>
            End the room
          </button>
        )}
      </div>
    </section>
  );
}

/** Scores, with a way to fix a judging slip. */
function ScorePanel({ view, act }: Omit<Props, "skew">) {
  const [fixing, setFixing] = useState(false);
  const adjust = (id: string, name: string) => {
    const raw = window.prompt(`Change ${name}'s score by how much? (for example 200 or -200)`);
    if (raw === null || raw.trim() === "") return;
    const delta = Number(raw.replace(/[−–]/g, "-").replace(/[, ]/g, ""));
    if (Number.isInteger(delta) && delta !== 0) act("adjustScore", { contestantId: id, delta });
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Scores</h2>
        <button className="btn btn-small btn-ghost" onClick={() => setFixing(!fixing)}>
          {fixing ? "Done" : "Fix a score"}
        </button>
      </div>
      {fixing ? (
        <ul className="people">
          {standings(view).map((c) => (
            <li key={c.id}>
              <span>
                {c.name} <strong>{pts(c.score)}</strong>
              </span>
              <button className="btn btn-small btn-secondary" onClick={() => adjust(c.id, c.name)}>
                Change
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Scores view={view} />
      )}
    </section>
  );
}
