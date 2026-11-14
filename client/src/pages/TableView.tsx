import type { RoomView } from "@buzzboard/shared";
import { Address, BoardGrid, QrCode, Scores, TimerBar, contestant, joinInfo, nameOf, nextUp, pts, roundLabel, standings } from "../components/bits";
import { useGameName } from "../useGameName";
import { useVenue } from "../useVenue";

/**
 * The TV: the board, the clue in play, who buzzed, the scores and how to join. Nothing
 * here can be tapped and nothing needs a pointer; the answers arrive only once the host
 * reveals them. Sized in viewport units to fill a 1080p screen with no scrolling.
 */
export function TableView({ view, skew }: { view: RoomView; skew: number }) {
  const venue = useVenue();
  const gameName = useGameName();
  const join = joinInfo(view.code, venue);
  const url = join.url;
  const logo = venue?.game.theme.logoUrl;
  const lobby = view.phase === "lobby";

  return (
    <main className={`tv phase-${view.phase}`}>
      <header className="tv-head">
        <div className="tv-title">
          {logo && <img className="tv-logo" src={logo} alt="" />}
          <span>{gameName}</span>
        </div>
        <div className="tv-round">{roundLabel(view)}</div>
        {!lobby && (
          <div className="tv-join">
            <span className="tv-join-text">
              <Address shown={join.shown} label="" tv style={{ alignItems: "flex-end", textAlign: "end" }} />
              {/* A short room link already carries the code. */}
              {!join.roomLink && <strong>{view.code}</strong>}
            </span>
            <QrCode text={url} size={96} />
          </div>
        )}
      </header>

      <section className="tv-stage">
        {lobby && <Lobby view={view} url={url} shown={join.shown} />}
        {view.phase === "board" && view.grid && <BoardGrid grid={view.grid} />}
        {view.phase === "clue" && view.clue && <Clue view={view} skew={skew} />}
        {view.phase === "roundEnd" && (
          <div className="tv-center">
            <p className="tv-kicker">End of {roundLabel(view).toLowerCase()}</p>
            <BigScores view={view} />
            <p className="tv-caption">Next: {nextUp(view)}</p>
          </div>
        )}
        {view.phase === "lastCall" && view.lastCall && <LastCall view={view} skew={skew} />}
        {view.phase === "final" && <Final view={view} />}
      </section>

      {!lobby && view.phase !== "roundEnd" && view.phase !== "final" && (
        <footer className="tv-scores">
          <Scores view={view} max={8} />
        </footer>
      )}
    </main>
  );
}

function Lobby({ view, url, shown }: { view: RoomView; url: string; shown: string }) {
  const people = view.contestants.flatMap((c) => c.members);
  return (
    <div className="tv-lobby">
      <div className="tv-lobby-join">
        <p className="tv-kicker">{view.hostOpen ? "Scan to host this game" : "Scan to play"}</p>
        <QrCode text={url} size={420} />
        <p className="tv-url">
          <Address shown={shown} tv />
        </p>
        <p className="tv-code">
          Room code <strong>{view.code}</strong>
        </p>
      </div>
      <div className="tv-lobby-who">
        <p className="tv-kicker">{view.boardTitle}</p>
        {view.hostOpen ? (
          <p className="tv-caption">Nobody is hosting yet. The first phone to join runs the game: picks the squares, reads the clues, judges the answers.</p>
        ) : people.length === 0 ? (
          <p className="tv-caption">Waiting for players…</p>
        ) : (
          <>
            <ul className="tv-people">
              {(view.settings.teams ? view.contestants.map((c) => ({ id: c.id, name: `${c.name} (${c.members.length})` })) : people).slice(0, 24).map((p) => (
                <li key={p.id}>{p.name}</li>
              ))}
            </ul>
            <p className="tv-caption">
              {view.settings.teams ? `${view.contestants.length} team${view.contestants.length === 1 ? "" : "s"}, ` : ""}
              {people.length} player{people.length === 1 ? "" : "s"} in. The host starts the game.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Clue({ view, skew }: { view: RoomView; skew: number }) {
  const clue = view.clue!;
  const who = contestant(view, clue.buzzedBy);
  return (
    <div className={`tv-clue stage-${clue.stage} ${clue.doubleDown ? "double-down" : ""}`}>
      <p className="tv-kicker">
        {clue.category} <span className="value">{pts(clue.value)}</span>
      </p>

      {clue.stage === "wager" ? (
        <div className="tv-splash">
          <p className="tv-splash-title">Double Down</p>
          <p className="tv-caption">
            <strong>{who?.name}</strong> answers alone, and is choosing a wager.
          </p>
        </div>
      ) : (
        <p className={`tv-clue-text ${(clue.text ?? "").length > 110 ? "long" : ""}`}>{clue.text}</p>
      )}

      <div className="tv-clue-foot">
        {clue.stage === "reading" && <p className="tv-caption">Listen up… buzzers open when the host finishes reading.</p>}
        {clue.stage === "open" && (
          <>
            <p className="tv-live">Buzz in!</p>
            <TimerBar deadline={clue.deadline} totalSeconds={view.settings.buzzSeconds} skew={skew} />
          </>
        )}
        {clue.stage === "answering" && (
          <p className="tv-buzzed">
            <strong>{clue.doubleDown ? who?.name : clue.buzzedName}</strong>
            {!clue.doubleDown && who && who.name !== clue.buzzedName && <span> for {who.name}</span>}
            {clue.doubleDown && <span> wagers {pts(clue.wager ?? 0)}</span>}
          </p>
        )}
        {clue.stage === "revealed" && (
          <>
            <p className="tv-answer">{clue.answer}</p>
            <p className="tv-caption">{clue.winnerId ? `${nameOf(view, clue.winnerId)} got it` : "Nobody got it"}</p>
          </>
        )}
      </div>
    </div>
  );
}

function LastCall({ view, skew }: { view: RoomView; skew: number }) {
  const lc = view.lastCall!;
  const current = lc.entries.find((e) => e.contestantId === lc.revealing);
  const chips = (done: (e: (typeof lc.entries)[number]) => boolean) => (
    <ul className="tv-chips">
      {lc.entries.slice(0, 16).map((e) => (
        <li key={e.contestantId} className={done(e) ? "done" : ""}>
          {nameOf(view, e.contestantId)}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="tv-clue">
      <p className="tv-kicker">
        Last Call <span className="value">{lc.category}</span>
      </p>
      {lc.stage === "wager" && (
        <>
          <div className="tv-splash">
            <p className="tv-splash-title">Last Call</p>
            <p className="tv-caption">One clue. Wager in secret on your phone: the category is {lc.category}.</p>
          </div>
          <div className="tv-clue-foot">{chips((e) => e.wagered)}</div>
        </>
      )}
      {lc.stage === "answer" && (
        <>
          <p className={`tv-clue-text ${(lc.text ?? "").length > 110 ? "long" : ""}`}>{lc.text}</p>
          <div className="tv-clue-foot">
            <TimerBar deadline={lc.deadline} totalSeconds={view.settings.lastCallSeconds} skew={skew} />
            {chips((e) => e.answered)}
          </div>
        </>
      )}
      {lc.stage === "reveal" && (
        <>
          <p className="tv-clue-text small">{lc.text}</p>
          <div className="tv-clue-foot">
            {current ? (
              <>
                <p className="tv-buzzed">
                  <strong>{nameOf(view, current.contestantId)}</strong>
                </p>
                <p className={`tv-answer ${current.correct === null ? "" : current.correct ? "right" : "wrong"}`}>
                  {current.answer || "(no answer)"}
                  {current.correct !== null && (
                    <span className="tv-delta">
                      {current.correct ? " ✓ +" : " ✗ −"}
                      {pts(current.wager ?? 0)}
                    </span>
                  )}
                </p>
              </>
            ) : (
              <p className="tv-caption">Answers are locked. Lowest score first…</p>
            )}
            {lc.answer && <p className="tv-caption">The answer: {lc.answer}</p>}
          </div>
        </>
      )}
    </div>
  );
}

function BigScores({ view }: { view: RoomView }) {
  return (
    <ol className="tv-standings">
      {standings(view)
        .slice(0, 8)
        .map((c) => (
          <li key={c.id} className={`${view.winners.includes(c.id) ? "winner" : ""} ${c.score < 0 ? "neg" : ""}`}>
            <span>{c.name}</span>
            <strong>{pts(c.score)}</strong>
          </li>
        ))}
    </ol>
  );
}

function Final({ view }: { view: RoomView }) {
  const names = view.winners.map((id) => nameOf(view, id));
  return (
    <div className="tv-center">
      <p className="tv-kicker">{names.length > 1 ? "It's a tie" : "Winner"}</p>
      <p className="tv-winner">{names.join(" & ") || "Nobody"}</p>
      <BigScores view={view} />
      {view.lastCall?.answer && <p className="tv-caption">Last Call: {view.lastCall.answer}</p>}
    </div>
  );
}
