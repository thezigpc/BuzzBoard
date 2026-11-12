import { useEffect, useRef, useState, type FormEvent } from "react";
import { LAST_CALL_ANSWER_MAX, MIN_WAGER, NAME_MAX, type BuzzResult, type RoomView } from "@buzzboard/shared";
import { BoardGrid, Scores, TimerBar, contestant, nameOf, nextUp, pts, standings, useNow } from "../components/bits";
import { canBuzz, socket } from "../socket";
import type { Act } from "./RoomPage";

interface Props {
  view: RoomView;
  skew: number;
  act: Act;
  online: boolean;
}

/** A player's phone: their score, what's happening, and one big Buzz button. */
export function PlayerView({ view, skew, act, online }: Props) {
  const me = contestant(view, view.you.contestantId);
  const clue = view.phase === "clue" ? view.clue : null;
  const buzzing = clue !== null && !clue.doubleDown && clue.stage !== "revealed";
  return (
    <main className={`player ${buzzing ? "with-buzzer" : ""}`}>
      <section className="me">
        <div>
          <span className="me-name">{me?.name ?? view.you.name}</span>
          {view.settings.teams && me && <span className="muted small"> · {view.you.name}</span>}
        </div>
        <span className={`me-score ${me && me.score < 0 ? "neg" : ""}`}>{pts(me?.score ?? 0)}</span>
      </section>

      {view.phase === "lobby" && <Lobby view={view} act={act} />}
      {view.phase === "board" && <Board view={view} act={act} />}
      {clue && <Clue view={view} skew={skew} act={act} />}
      {view.phase === "roundEnd" && (
        <section className="panel">
          <h2>End of the round</h2>
          <p className="muted">Next: {nextUp(view)}.</p>
          <Scores view={view} mine={view.you.contestantId} />
        </section>
      )}
      {view.phase === "lastCall" && view.lastCall && <LastCall view={view} skew={skew} act={act} />}
      {view.phase === "final" && <Final view={view} />}

      {buzzing && <Buzzer view={view} skew={skew} online={online} />}
    </main>
  );
}

function Lobby({ view, act }: Pick<Props, "view" | "act">) {
  const me = contestant(view, view.you.contestantId);
  const [team, setTeam] = useState("");
  const others = view.contestants.filter((c) => c.id !== me?.id);
  const move = (name: string) => name.trim() && act("setTeam", { team: name.trim() }).then((ok) => ok && setTeam(""));
  return (
    <section className="panel">
      <h2>You're in</h2>
      <p className="muted">
        {view.hostConnected ? "The host will start the game soon." : "Waiting for the host."} When a clue comes up, wait for the host to finish reading it,
        then hit the buzzer. Buzz too early and you're locked out for a moment.
      </p>
      {view.settings.teams && (
        <>
          <p>
            Your team: <strong>{me?.name}</strong>
            {me && me.members.length > 1 && <span className="muted"> ({me.members.map((m) => m.name).join(", ")})</span>}
          </p>
          {others.length > 0 && (
            <div className="row wrap">
              {others.map((c) => (
                <button key={c.id} className="btn btn-small btn-ghost" onClick={() => move(c.name)}>
                  Switch to {c.name}
                </button>
              ))}
            </div>
          )}
          <form
            className="row"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              move(team);
            }}
          >
            <input value={team} onChange={(e) => setTeam(e.target.value.slice(0, NAME_MAX))} placeholder="Or start a new team" aria-label="New team name" />
            <button className="btn btn-secondary" disabled={!team.trim()}>
              Go
            </button>
          </form>
        </>
      )}
      {!view.settings.teams && view.contestants.length > 1 && <p className="muted small">{view.contestants.length} players are in.</p>}
    </section>
  );
}

function Board({ view, act }: Pick<Props, "view" | "act">) {
  const mine = view.pickerId !== null && view.pickerId === view.you.contestantId;
  const canPick = mine && view.settings.playersPick;
  return (
    <section className="panel">
      <p className={`status ${mine ? "live" : ""}`}>
        {mine
          ? canPick
            ? "Your pick! Tap a square."
            : "Your pick! Tell the host a category and a value."
          : view.pickerId
            ? `${nameOf(view, view.pickerId)} picks the next square.`
            : "The host picks the next square."}
      </p>
      <BoardGrid grid={view.grid!} onPick={canPick ? (cat, row) => act("pickSquare", { cat, row }) : undefined} />
      <Scores view={view} mine={view.you.contestantId} />
    </section>
  );
}

function Clue({ view, skew, act }: Pick<Props, "view" | "skew" | "act">) {
  const clue = view.clue!;
  const mine = clue.buzzedBy !== null && clue.buzzedBy === view.you.contestantId;
  const [wager, setWager] = useState("");
  return (
    <section className="panel clue-panel">
      <div className="panel-head">
        <h2>
          {clue.category} <span className="value">{pts(clue.value)}</span>
        </h2>
        {clue.doubleDown && <span className="tag hot">Double Down</span>}
      </div>
      {clue.text && <p className="clue-text">{clue.text}</p>}

      {clue.stage === "wager" &&
        (mine ? (
          <form
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              act("setWager", { amount: Number(wager) });
            }}
          >
            <p className="status live">Double Down! Only you answer this one. How much do you wager?</p>
            <label>
              Your wager ({MIN_WAGER} to {pts(clue.wagerMax)})
              <input type="number" inputMode="numeric" min={MIN_WAGER} max={clue.wagerMax} value={wager} onChange={(e) => setWager(e.target.value)} autoFocus />
            </label>
            <div className="row wrap">
              {[...new Set([clue.value, Math.round(clue.wagerMax / 2), clue.wagerMax])].map((n) => (
                <button type="button" key={n} className="btn btn-small btn-ghost" onClick={() => setWager(String(n))}>
                  {pts(n)}
                </button>
              ))}
            </div>
            <button className="btn btn-primary btn-big" disabled={wager === "" || Number(wager) < MIN_WAGER || Number(wager) > clue.wagerMax}>
              Lock it in
            </button>
          </form>
        ) : (
          <p className="status">{nameOf(view, clue.buzzedBy)} found a Double Down and is choosing a wager. Only they answer.</p>
        ))}

      {clue.doubleDown && clue.stage === "answering" && (
        <p className={`status ${mine ? "live" : ""}`}>
          {mine ? `You wagered ${pts(clue.wager ?? 0)}. Answer out loud!` : `${nameOf(view, clue.buzzedBy)} wagered ${pts(clue.wager ?? 0)}.`}
        </p>
      )}
      {!clue.doubleDown && clue.stage === "open" && <TimerBar deadline={clue.deadline} totalSeconds={view.settings.buzzSeconds} skew={skew} />}

      {clue.stage === "revealed" && (
        <>
          <p className="answer">
            <span className="muted small">Answer</span>
            {clue.answer}
          </p>
          <p className="status">
            {clue.winnerId ? (clue.winnerId === view.you.contestantId ? "You got it! You pick next." : `${nameOf(view, clue.winnerId)} got it.`) : "Nobody got it."}
          </p>
        </>
      )}
    </section>
  );
}

/**
 * The buzzer: pinned to the bottom of the screen (above a venue announcement shown there).
 * It fires on touch-down, not on the click that follows the finger lifting. The phone
 * only reports the press; the server's clock decides who was first.
 */
function Buzzer({ view, skew, online }: Pick<Props, "view" | "skew" | "online">) {
  const clue = view.clue!;
  const myId = view.you.contestantId;
  const [last, setLast] = useState<{ result: BuzzResult | "error"; clue: string } | null>(null);
  const clueKey = `${view.round}:${clue.cat}:${clue.row}:${clue.lockedOut.length}`;
  const now = useNow(view.you.penaltyUntil !== null, 50);
  const penalized = view.you.penaltyUntil !== null && view.you.penaltyUntil > now + skew;
  const pressed = useRef(0);

  const press = () => {
    // One press per touch (a pointerdown and its keyboard twin both land here).
    if (Date.now() - pressed.current < 60) return;
    pressed.current = Date.now();
    socket.emit("buzz", (res) => setLast({ result: res.ok ? res.result : "error", clue: clueKey }));
    navigator.vibrate?.(30);
  };
  useEffect(() => setLast(null), [clueKey]);

  const lockedOut = myId !== null && clue.lockedOut.includes(myId);
  const mine = clue.buzzedBy !== null && clue.buzzedBy === myId;
  const linkOk = online && canBuzz();

  let state: "wait" | "ready" | "mine" | "theirs" | "out" | "penalty" = "wait";
  let label = "BUZZ";
  let hint = "Wait for the host to finish reading…";
  if (!linkOk) {
    state = "out";
    label = "…";
    hint = "Reconnecting. Your buzzer will be back in a moment.";
  } else if (clue.stage === "answering") {
    state = mine ? "mine" : "theirs";
    label = mine ? "YOU'RE IN" : "LOCKED";
    hint = mine
      ? clue.buzzedName === view.you.name
        ? "Answer out loud!"
        : `${clue.buzzedName} buzzed for your team. Answer out loud!`
      : `${clue.buzzedName} buzzed in first${last?.clue === clueKey && last.result === "late" ? ". Just too late!" : "."}`;
  } else if (lockedOut) {
    state = "out";
    label = "LOCKED";
    hint = view.settings.teams ? "Your team already answered this one." : "You already answered this one.";
  } else if (penalized) {
    state = "penalty";
    label = "TOO EARLY";
    hint = "Locked for a moment. Wait for the buzzers to open.";
  } else if (clue.stage === "open") {
    state = "ready";
    hint = "Buzzers are open!";
  }
  const dead = state === "theirs" || state === "out" || state === "mine";

  return (
    <div className={`buzz-bar buzz-${state}`}>
      <p className="buzz-hint" role="status">
        {hint}
      </p>
      <button
        className="buzz"
        disabled={dead}
        onPointerDown={(e) => {
          e.preventDefault();
          press();
        }}
        onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && press()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {label}
      </button>
    </div>
  );
}

function LastCall({ view, skew, act }: Pick<Props, "view" | "skew" | "act">) {
  const lc = view.lastCall!;
  const mine = lc.mine;
  const [wager, setWager] = useState("");
  const [answer, setAnswer] = useState(mine?.answer ?? "");
  const [sent, setSent] = useState(false);
  const myEntry = lc.entries.find((e) => e.contestantId === view.you.contestantId);
  const current = lc.entries.find((e) => e.contestantId === lc.revealing);

  return (
    <section className="panel clue-panel">
      <div className="panel-head">
        <h2>Last Call</h2>
        <span className="tag">{lc.category}</span>
      </div>
      {lc.text && <p className="clue-text">{lc.text}</p>}

      {!mine && lc.stage !== "reveal" && <p className="status">You joined after Last Call began, so you're watching this one.</p>}

      {lc.stage === "wager" && mine && (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            act("lastCallWager", { amount: Number(wager) }).then((ok) => ok && setWager(""));
          }}
        >
          <p className="status live">One last clue. The category is {lc.category}. How much will you risk?</p>
          {mine.wager !== null && (
            <p>
              Wager locked in: <strong>{pts(mine.wager)}</strong>
              <span className="muted small"> (you can change it until the clue appears)</span>
            </p>
          )}
          <label>
            {view.settings.teams ? "Your team's wager" : "Your wager"} (0 to {pts(mine.wagerMax)})
            <input type="number" inputMode="numeric" min={0} max={mine.wagerMax} value={wager} onChange={(e) => setWager(e.target.value)} />
          </label>
          <div className="row wrap">
            {[...new Set([0, Math.round(mine.wagerMax / 2), mine.wagerMax])].map((n) => (
              <button type="button" key={n} className="btn btn-small btn-ghost" onClick={() => setWager(String(n))}>
                {n === mine.wagerMax ? `All in: ${pts(n)}` : pts(n)}
              </button>
            ))}
          </div>
          <button className="btn btn-primary btn-big" disabled={wager === "" || Number(wager) < 0 || Number(wager) > mine.wagerMax}>
            {mine.wager === null ? "Lock in my wager" : "Change my wager"}
          </button>
        </form>
      )}

      {lc.stage === "answer" && (
        <>
          <TimerBar deadline={lc.deadline} totalSeconds={view.settings.lastCallSeconds} skew={skew} />
          {mine && (
            <form
              onSubmit={(e: FormEvent) => {
                e.preventDefault();
                act("lastCallAnswer", { text: answer }).then((ok) => setSent(ok !== null));
              }}
            >
              <label>
                {view.settings.teams ? "Your team's answer" : "Your answer"}
                <input
                  value={answer}
                  onChange={(e) => {
                    setAnswer(e.target.value.slice(0, LAST_CALL_ANSWER_MAX));
                    setSent(false);
                  }}
                  autoComplete="off"
                  autoFocus
                />
              </label>
              <button className="btn btn-primary btn-big" disabled={answer.trim() === ""}>
                {sent ? "Sent ✓ (send again to change)" : "Send my answer"}
              </button>
              <p className="muted small">
                Riding on it: {pts(mine.wager ?? 0)}.{mine.answer ? ` Sent so far: "${mine.answer}".` : " Nothing sent yet."} Whatever is sent when the clock runs out counts.
              </p>
            </form>
          )}
        </>
      )}

      {lc.stage === "reveal" && (
        <>
          {mine && (
            <p className="muted small">
              You wrote "{mine.answer || "nothing"}" and wagered {pts(mine.wager ?? 0)}.
              {myEntry && myEntry.correct !== null && (myEntry.correct ? " Right!" : " Wrong.")}
            </p>
          )}
          {current ? (
            <p className="status">
              {nameOf(view, current.contestantId)}: <q>{current.answer || "(nothing)"}</q>
              {current.correct !== null && ` ${current.correct ? "✓ +" : "✗ −"}${pts(current.wager ?? 0)}`}
            </p>
          ) : (
            <p className="status">Answers are locked. The host reveals them one by one.</p>
          )}
          {lc.answer && (
            <p className="answer">
              <span className="muted small">Answer</span>
              {lc.answer}
            </p>
          )}
          <Scores view={view} mine={view.you.contestantId} />
        </>
      )}
    </section>
  );
}

function Final({ view }: Pick<Props, "view">) {
  const order = standings(view);
  const myPlace = order.findIndex((c) => c.id === view.you.contestantId);
  const won = view.you.contestantId !== null && view.winners.includes(view.you.contestantId);
  return (
    <section className="panel">
      <h2>{won ? (view.winners.length > 1 ? "You tied for the win!" : "You won!") : "Game over"}</h2>
      <p className="winner-name">{view.winners.map((id) => nameOf(view, id)).join(" & ")}</p>
      {!won && myPlace >= 0 && <p className="muted">You finished {ordinal(myPlace + 1)}.</p>}
      <Scores view={view} mine={view.you.contestantId} />
      <p className="muted small">Stay here: the host can start another game.</p>
    </section>
  );
}

const ordinal = (n: number): string => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
