// Moving the app to a new address without losing anyone's data.
//
// Browser storage belongs to one origin, so when the app moves (the repository
// changed owner, and its GitHub Pages address with it) every visitor's places
// stay behind at the old address, where the new one cannot read them. The same
// build is served at both addresses; which role it plays comes from where it
// runs:
//
//   old address (origin ≠ VITE_CANONICAL_URL's)   new address
//   ───────────────────────────────────────────   ─────────────────────────────
//   no data, or moved before → redirect           normal app
//   data → "moved" screen, Move my places  ──▶    opens with ?handoff=1
//                               ◀── ready ───     (only for VITE_HANDOFF_FROM)
//                ─── the portable file ──▶        restoreFromJson
//                         ◀── done/failed ───
//   done → clear places + sync settings, flag
//
// Only the portable file crosses — the same inert, validated JSON as a manual
// backup, never localStorage, so the sync token never reaches the new origin;
// the old one drops it once the move is done.
// Both env vars unset (local dev, the native wrap) turns all of this off.

export const HANDOFF_PARAM = "handoff";
/** Set at the old address once its data reached the new one: later visits redirect. */
export const MOVED_FLAG = "postcards-moved-at";

export type HandoffMessage =
  | { type: "postcards-handoff-ready" }
  | { type: "postcards-handoff-file"; text: string }
  | { type: "postcards-handoff-done" }
  | { type: "postcards-handoff-failed"; cancelled: boolean };

export const CANONICAL_URL: string | undefined = import.meta.env.VITE_CANONICAL_URL || undefined;
/** The one old origin allowed to hand its data to this one. */
export const HANDOFF_FROM: string | undefined = import.meta.env.VITE_HANDOFF_FROM || undefined;
/** Whether this page load was opened by the old address to take its data. */
export const handoffRequested =
  typeof window !== "undefined" && new URL(window.location.href).searchParams.has(HANDOFF_PARAM);

/**
 * The same page at the canonical address, or null when this already is it (or no
 * canonical address is configured). The path below the base, the query and the
 * hash carry over, so a deep link keeps pointing at what it pointed at.
 */
export function movedTarget(
  loc: Pick<Location, "origin" | "pathname" | "search" | "hash">,
  base: string,
  canonical: string | undefined,
): string | null {
  if (!canonical) return null;
  const target = new URL(canonical);
  if (target.origin === loc.origin) return null;
  const rest = loc.pathname.startsWith(base) ? loc.pathname.slice(base.length) : "";
  // A path starting `//` would resolve to another host: forward only within the app.
  const next = new URL(rest + loc.search + loc.hash, target);
  return next.origin === target.origin ? next.href : target.href;
}

/**
 * A postMessage event read as a handoff message, or null. Accepted only from the
 * expected window AND origin, and only in a known shape: any other page that
 * happens to hold a reference to this one is ignored.
 */
export function readHandoff(
  e: Pick<MessageEvent, "origin" | "source" | "data">,
  origin: string | undefined,
  source: unknown,
): HandoffMessage | null {
  if (!source || !origin || e.source !== source || e.origin !== origin) return null;
  const d = e.data as { type?: unknown; text?: unknown; cancelled?: unknown } | null;
  if (!d || typeof d !== "object") return null;
  switch (d.type) {
    case "postcards-handoff-ready":
    case "postcards-handoff-done":
      return { type: d.type };
    case "postcards-handoff-file":
      return typeof d.text === "string" ? { type: d.type, text: d.text } : null;
    case "postcards-handoff-failed":
      return { type: d.type, cancelled: d.cancelled === true };
    default:
      return null;
  }
}
