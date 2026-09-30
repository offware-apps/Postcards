import type { PlaceRef, TravelMode, Trip } from "../../lib/schema/models";

// Immutable ordered-stops helpers for the trip composer (spec 019). Pure, no I/O —
// each returns a NEW array so React state updates stay predictable. A reconstructed
// trip is an ordered chain of stops; `from`/`to` are just its first/last stop.

/** A saved trip's ordered stops: its `stops` when it has them, else `from → to`.
 *  Leg i runs from stop i to stop i+1, in `legModes[i]` or the trip's `mode`. */
export function tripChain(trip: Pick<Trip, "from" | "to" | "stops">): PlaceRef[] {
  return trip.stops && trip.stops.length >= 2 ? trip.stops : [trip.from, trip.to];
}

/** Move a stop from one position to another; indices are clamped, so a drag past
 *  the ends just parks it at the end. A no-op move returns an equal-length copy. */
export function moveStop(stops: PlaceRef[], from: number, to: number): PlaceRef[] {
  const n = stops.length;
  if (n === 0) return [];
  const clamp = (i: number) => Math.max(0, Math.min(n - 1, i));
  const src = clamp(from);
  const dst = clamp(to);
  if (src === dst) return [...stops];
  const next = [...stops];
  const [moved] = next.splice(src, 1);
  next.splice(dst, 0, moved!);
  return next;
}

// ── Per-leg transport (spec 019) ────────────────────────────────────────────────
// A journey can mix transports: the mode of the leg from stop i to stop i+1 lives
// in `legModes[i]`, and a run of the same mode reads as a sub-trip. `legModes` is
// kept the right length (stops − 1) as stops are added/removed/reordered; a leg
// with no explicit entry falls back to the trip's default mode.

export interface StopChain {
  stops: PlaceRef[];
  legModes: TravelMode[];
}

/** Fit legModes to exactly `stopCount − 1` entries, keeping existing modes and
 *  padding any new legs with `fill`. */
function fitLegs(legModes: TravelMode[], stopCount: number, fill: TravelMode): TravelMode[] {
  const need = Math.max(0, stopCount - 1);
  if (legModes.length === need) return legModes;
  const out = legModes.slice(0, need);
  while (out.length < need) out.push(fill);
  return out;
}

/** Append a stop, adding a new leg (mode `fill`) when it creates one. */
export function appendStop(chain: StopChain, place: PlaceRef, fill: TravelMode): StopChain {
  const stops = [...chain.stops, place];
  return { stops, legModes: fitLegs(chain.legModes, stops.length, fill) };
}

/** Remove the stop at `index`; the two legs it joined collapse into one (the
 *  incoming leg's mode is dropped), then legModes is refit. */
export function removeStopAt(chain: StopChain, index: number, fill: TravelMode): StopChain {
  if (index < 0 || index >= chain.stops.length) return chain;
  const stops = chain.stops.filter((_, i) => i !== index);
  const legModes = [...chain.legModes];
  const drop = index > 0 ? index - 1 : 0;
  if (drop < legModes.length) legModes.splice(drop, 1);
  return { stops, legModes: fitLegs(legModes, stops.length, fill) };
}

/** Move a stop; leg modes can't map cleanly across an arbitrary reorder, so the
 *  array is kept valid (right length, existing modes by position) — a leg the user
 *  cares about is one tap to re-set. */
export function moveStopTo(chain: StopChain, from: number, to: number, fill: TravelMode): StopChain {
  const stops = moveStop(chain.stops, from, to);
  return { stops, legModes: fitLegs(chain.legModes, stops.length, fill) };
}

/** Set the transport mode of leg `legIndex` (stop legIndex → legIndex+1). */
export function setLegMode(chain: StopChain, legIndex: number, mode: TravelMode): StopChain {
  if (legIndex < 0 || legIndex >= chain.legModes.length) return chain;
  const legModes = [...chain.legModes];
  legModes[legIndex] = mode;
  return { ...chain, legModes };
}
