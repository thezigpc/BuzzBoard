import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BackToGames } from "@bargames/gamekit/client";
import { NAME_MAX, type JoinResult, type RoomInfo } from "@buzzboard/shared";
import { call } from "../socket";
import { lastName, lastTeam, loadSession, rememberName, rememberTeam, saveSession } from "../session";
import { useGameName } from "../useGameName";
import { useVenue } from "../useVenue";

const NEW_TEAM = "\u0000new";

export function HomePage() {
  const navigate = useNavigate();
  const params = useParams();
  const [search] = useSearchParams();
  const gameName = useGameName();
  const venue = useVenue();
  const [code, setCode] = useState((params.code ?? "").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4));
  const [name, setName] = useState(lastName());
  const [team, setTeam] = useState("");
  const [newTeam, setNewTeam] = useState(lastTeam());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Ask the room before showing the form: does it use teams, and is its host seat open
  // (a room the venue put on a TV, waiting for someone to run it)?
  const [info, setInfo] = useState<RoomInfo | null>(null);
  useEffect(() => {
    setInfo(null);
    if (code.length !== 4) return;
    let live = true;
    call<RoomInfo>("roomInfo", { code })
      .then((r) => {
        if (!live) return;
        setInfo(r);
        const mine = r.teamNames.find((t) => t.toLowerCase() === lastTeam().toLowerCase());
        setTeam(mine ?? (r.teamNames.length ? "" : NEW_TEAM));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [code]);
  // /join/ABCD?cohost=<invite>: the host's (or the box's) "Add a co-host" QR. Single use;
  // the phone joins as a co-host under the name typed (a player here is promoted).
  const cohostInvite = search.get("cohost") ?? undefined;
  const teams = info?.teams === true && !info.hostOpen && !cohostInvite;
  const teamName = team === NEW_TEAM ? newTeam.trim() : team;

  const enter = (r: JoinResult) => {
    saveSession({ roomCode: r.code, token: r.token, name: r.name, role: r.role });
    navigate(`/room/${r.code}`, { replace: true });
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  const host = () => run(async () => enter(await call<JoinResult>("createRoom", { name: name.trim() })));

  const join = () =>
    run(async () => {
      const roomCode = code.trim().toUpperCase();
      if (roomCode.length !== 4) throw new Error("Room codes are 4 letters.");
      // Back on a device that already has a seat here: the same seat, never a second one.
      const existing = loadSession();
      const token = existing?.roomCode === roomCode && existing.role !== "table" ? existing.token : undefined;
      rememberName(name.trim());
      if (teams && teamName) rememberTeam(teamName);
      enter(
        await call<JoinResult>("joinRoom", {
          code: roomCode,
          role: "player",
          name: name.trim(),
          team: teams ? teamName : undefined,
          token,
          cohost: cohostInvite,
        }),
      );
    });

  // /join/ABCD?host=<key>: a Bar Games box's host link (create_room's hostUrl, or "Take
  // over as host"). The room page resumes the host seat with the key, then keeps the
  // seat's own token, so a later take-over leaves this phone on as a co-host.
  useEffect(() => {
    const hostToken = search.get("host");
    if (hostToken && code.length === 4) {
      saveSession({ roomCode: code, token: hostToken, name: "Venue", role: "host", hostLink: true });
      navigate(`/room/${code}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onJoin = (e: FormEvent) => {
    e.preventDefault();
    join();
  };
  const ready = code.length === 4 && name.trim() !== "" && (!teams || teamName !== "");

  return (
    <main className="home">
      <header className="home-hero">
        <div className="hero-buzzer" aria-hidden />
        <h1>{gameName}</h1>
        <p className="muted">A quiz board on the big screen. Buzz in from your phone. A host runs the game.</p>
      </header>

      <form className="panel" onSubmit={onJoin}>
        <h2>Join a game</h2>
        <label>
          Room code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4))}
            placeholder="ABCD"
            autoCapitalize="characters"
            autoComplete="off"
            inputMode="text"
            className="code-input"
          />
        </label>
        <label>
          Your name
          <input value={name} onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))} placeholder="Name" autoComplete="nickname" />
        </label>
        {teams && (
          <>
            <label>
              Your team
              <select value={team} onChange={(e) => setTeam(e.target.value)}>
                {info!.teamNames.length > 0 && <option value="">Pick a team…</option>}
                {info!.teamNames.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                <option value={NEW_TEAM}>Start a new team</option>
              </select>
            </label>
            {team === NEW_TEAM && (
              <label>
                New team's name
                <input value={newTeam} onChange={(e) => setNewTeam(e.target.value.slice(0, NAME_MAX))} placeholder="Table 4, The Quizzards…" />
              </label>
            )}
          </>
        )}
        {cohostInvite && (
          <p className="note small">
            You've been invited to co-host: you'll run the game with the host (pick squares, open the buzzers, judge, keep score), and you
            don't play. The invite works once.
          </p>
        )}
        {info?.hostOpen && !cohostInvite && (
          <p className="note small">
            Nobody is hosting this game yet. Join now and you'll be the host: you pick the squares, read the clues and judge the answers, and
            you don't play.
          </p>
        )}
        {info && !info.hostOpen && info.phase !== "lobby" && <p className="muted small">This game has started. You can still join in.</p>}
        <button className="btn btn-primary btn-big" disabled={busy || !ready}>
          {cohostInvite ? "Join as co-host" : info?.hostOpen ? "Host this game" : "Join"}
        </button>
      </form>

      <section className="panel">
        <h2>Host a game</h2>
        <p className="muted">
          Start a room on this phone or tablet. You read the clues and judge the answers; everyone else joins with the room code. Put the
          board on a TV if you have one.
        </p>
        <button className="btn btn-secondary btn-big" disabled={busy} onClick={host}>
          Host a new game
        </button>
      </section>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <footer className="home-foot">
        <Link to="/admin" className="muted small">
          Admin
        </Link>
      </footer>

      {/* Bar Games: back to the venue's games list. Landing page only; nothing off a box. */}
      {!search.get("host") && !cohostInvite && <BackToGames ctx={venue} />}
    </main>
  );
}
