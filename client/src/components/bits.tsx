import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { addressScale, JoinAddress, shortAddress } from "@bargames/gamekit/client";
import { joinUrl as venueJoinUrl, type VenueContext } from "@bargames/sdk/client";
import type { ContestantView, GridView, RoomView } from "@buzzboard/shared";

/** Points as text: 1,200 or −300 (a real minus sign, so it reads from across the room). */
export const pts = (n: number): string => (n < 0 ? `−${Math.abs(n).toLocaleString("en-US")}` : n.toLocaleString("en-US"));

export const contestant = (view: RoomView, id: string | null | undefined): ContestantView | undefined =>
  id ? view.contestants.find((c) => c.id === id) : undefined;

export const nameOf = (view: RoomView, id: string | null | undefined): string => contestant(view, id)?.name ?? "";

/** Highest score first; join order on a tie. */
export const standings = (view: RoomView): ContestantView[] =>
  view.contestants.map((c, i) => ({ c, i })).sort((a, b) => b.c.score - a.c.score || a.i - b.i).map((x) => x.c);

/** Re-renders a few times a second while `active`, for countdowns. */
export function useNow(active: boolean, everyMs = 100): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(t);
  }, [active, everyMs]);
  return now;
}

/** A draining bar and the seconds left until `deadline` (server time; `skew` = server − local). */
export function TimerBar({ deadline, totalSeconds, skew }: { deadline: number | null; totalSeconds: number; skew: number }) {
  const now = useNow(deadline !== null);
  if (deadline === null) return null;
  const left = Math.max(0, deadline - (now + skew));
  const pct = Math.min(100, (left / (totalSeconds * 1000)) * 100);
  return (
    <div className="timer" role="timer" aria-label={`${Math.ceil(left / 1000)} seconds left`}>
      <div className="timer-fill" style={{ width: `${pct}%` }} />
      <span className="timer-num">{Math.ceil(left / 1000)}</span>
    </div>
  );
}

export function QrCode({ text, size = 160 }: { text: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    QRCode.toDataURL(text, { margin: 1, width: size * 2 })
      .then(setSrc)
      .catch(() => setSrc(""));
  }, [text, size]);
  return src ? <img className="qr" src={src} width={size} height={size} alt={`QR code for ${text}`} /> : null;
}

/**
 * A room's join link (and QR code). On a Bar Games box it's on the venue's public
 * address (which a TV opened on an internal address wouldn't know), path prefix
 * included; standalone it's this page's own origin.
 */
export const joinUrl = (code: string, venue: VenueContext | null = null) => venueJoinUrl(venue, `/join/${code}`);

/** A link without its scheme, for reading off a screen. */
export const shortUrl = (url: string): string => url.replace(/^https?:\/\//, "");

/** The game's own address from a room link: "https://venue/buzzboard/join/ABCD" -> "venue/buzzboard". */
export const siteAddress = (url: string): string => shortAddress(url.replace(/\/join\/[^/?#]+([?#].*)?$/, ""));

/**
 * "Join at <address>", from the kit: breaks after "." and "/", shrinks a long address and
 * never overflows its box (a venue address has no spaces to wrap at). The box's width is
 * the caller's CSS. `--join-scale` lets the TV keep a floor under the shrinking (index.css).
 */
export function Address({ url, label = "Join at", className }: { url: string; label?: string; className?: string }) {
  const site = siteAddress(url);
  return <JoinAddress url={site} label={label} className={className} style={{ ["--join-scale" as string]: addressScale(site) }} />;
}

/** The board: a column per category, a row per point value. `onPick` makes open squares buttons. */
export function BoardGrid({
  grid,
  onPick,
  active,
}: {
  grid: GridView;
  onPick?: (cat: number, row: number) => void;
  active?: { cat: number; row: number } | null;
}) {
  return (
    <div className="grid" style={{ gridTemplateColumns: `repeat(${grid.categories.length}, minmax(0, 1fr))` }}>
      {grid.categories.map((name, cat) => (
        <div className="grid-cat" key={`c${cat}`} style={{ gridColumn: cat + 1, gridRow: 1 }}>
          <span>{name}</span>
        </div>
      ))}
      {grid.cells.map((col, cat) =>
        col.map((cell, row) => {
          const style = { gridColumn: cat + 1, gridRow: row + 2 };
          const on = active?.cat === cat && active.row === row;
          const cls = `grid-cell ${cell} ${on ? "active" : ""}`;
          const label = cell === "open" || on ? pts(grid.values[row]) : "";
          return onPick && cell === "open" ? (
            <button key={`${cat}:${row}`} className={cls} style={style} onClick={() => onPick(cat, row)} aria-label={`${name(grid, cat)} for ${grid.values[row]}`}>
              {label}
            </button>
          ) : (
            <div key={`${cat}:${row}`} className={cls} style={style}>
              {label}
            </div>
          );
        }),
      )}
    </div>
  );
}
const name = (grid: GridView, cat: number) => grid.categories[cat];

/** Scores, highest first. `max` cuts the list (the TV's strip) and says how many more there are. */
export function Scores({ view, max, mine }: { view: RoomView; max?: number; mine?: string | null }) {
  const all = standings(view);
  const shown = max ? all.slice(0, max) : all;
  return (
    <ol className="scores">
      {shown.map((c) => (
        <li
          key={c.id}
          className={`score ${c.id === mine ? "mine" : ""} ${c.id === view.pickerId && (view.phase === "board" || view.phase === "clue") ? "picker" : ""} ${c.connected ? "" : "away"} ${c.score < 0 ? "neg" : ""}`}
        >
          <span className="score-name">{c.name}</span>
          <span className="score-pts">{pts(c.score)}</span>
        </li>
      ))}
      {max !== undefined && all.length > shown.length && <li className="score more">+{all.length - shown.length} more</li>}
    </ol>
  );
}

/** "Round 1 of 2", "Last Call", or nothing in the lobby. */
export function roundLabel(view: RoomView): string {
  if (view.phase === "lobby") return "";
  if (view.phase === "lastCall") return "Last Call";
  if (view.phase === "final") return "Final scores";
  return view.roundCount > 1 ? `Round ${view.round} of ${view.roundCount}` : "Round 1";
}

/** What comes after this round: the host's button and the TV's caption use the same words. */
export function nextUp(view: RoomView): string {
  if (view.round < view.roundCount) return `Round ${view.round + 1}`;
  return view.hasLastCall && view.contestants.length > 0 ? "Last Call" : "Final scores";
}
