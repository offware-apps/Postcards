import type { PlaceRef, TravelMode } from "../../lib/schema/models";

// Immutable ordered-stops helpers for the trip composer (spec 019). Pure, no I/O —
// each returns a NEW array so React state updates stay predictable. A reconstructed
// trip is an ordered chain of stops; `from`/`to` are just its first/last stop.

/** Append a stop to the end of the chain. */
export function addStop(stops: PlaceRef[], place: PlaceRef): PlaceRef[] {
  return [...stops, place];
}

/** Remove the stop at `index` (out-of-range index is a no-op copy). */
export function removeStop(stops: PlaceRef[], index: number): PlaceRef[] {
  if (index < 0 || index >= stops.length) return [...stops];
  return stops.filter((_, i) => i !== index);
}

/** Move a stop from one position to another; indices are clamped, so a drag past
 *  the ends just parks it at the end. A no-op move returns an equal-length copy. */
export function moveStop(stops: PlaceRef[], from: number, to: number): PlaceRef[] {
  return moveItem(stops, from, to);
}

/** Generic reorder used for stops AND anything aligned to them (per-stop dates),
 *  so a value travels with its stop across a move. Indices are clamped. */
function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const n = arr.length;
  if (n === 0) return [];
  const clamp = (i: number) => Math.max(0, Math.min(n - 1, i));
  const src = clamp(from);
  const dst = clamp(to);
  if (src === dst) return [...arr];
  const next = [...arr];
  const [moved] = next.splice(src, 1);
  next.splice(dst, 0, moved!);
  return next;
}

/** The journey's endpoints (first/last stop), or null when there are fewer than two
 *  stops — a reconstructed trip needs at least two to have a `from → to`. */
export function endpoints(stops: PlaceRef[]): { from: PlaceRef; to: PlaceRef } | null {
  if (stops.length < 2) return null;
  return { from: stops[0]!, to: stops[stops.length - 1]! };
}

// ── Per-leg transport (spec 019) ────────────────────────────────────────────────
// A journey can mix transports: the mode of the leg from stop i to stop i+1 lives
// in `legModes[i]`, and a run of the same mode reads as a sub-trip. `legModes` is
// kept the right length (stops − 1) as stops are added/removed/reordered; a leg
// with no explicit entry falls back to the trip's default mode.

export interface StopChain {
  stops: PlaceRef[];
  legModes: TravelMode[];
  /**
   * Optional per-STOP date (spec 021), aligned to `stops` — `stopDates[i]` dates
   * `stops[i]`, as `YYYY`/`YYYY-MM`/`YYYY-MM-DD` or null. Unlike leg modes, a date
   * TRAVELS WITH ITS STOP across add/remove/reorder (it's a property of the place-
   * visit, not the segment). Left undefined when the composer isn't tracking dates,
   * so callers that don't pass it (and the leg tests) are unaffected.
   */
  stopDates?: (string | null)[];
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

/** Fit per-stop dates to exactly `stopCount` entries (padding with null), or leave
 *  them undefined when the chain isn't tracking dates. */
function fitDates(
  dates: (string | null)[] | undefined,
  stopCount: number,
): (string | null)[] | undefined {
  if (!dates) return undefined;
  if (dates.length === stopCount) return dates;
  const out = dates.slice(0, stopCount);
  while (out.length < stopCount) out.push(null);
  return out;
}

/** Append a stop, adding a new leg (mode `fill`) when it creates one; a tracked
 *  date array grows by one null for the new stop. */
export function appendStop(chain: StopChain, place: PlaceRef, fill: TravelMode): StopChain {
  const stops = [...chain.stops, place];
  return {
    stops,
    legModes: fitLegs(chain.legModes, stops.length, fill),
    ...(chain.stopDates
      ? { stopDates: fitDates([...chain.stopDates, null], stops.length) }
      : {}),
  };
}

/** Remove the stop at `index`; the two legs it joined collapse into one (the
 *  incoming leg's mode is dropped), and that stop's date is removed with it. */
export function removeStopAt(chain: StopChain, index: number, fill: TravelMode): StopChain {
  if (index < 0 || index >= chain.stops.length) return chain;
  const stops = chain.stops.filter((_, i) => i !== index);
  const legModes = [...chain.legModes];
  const drop = index > 0 ? index - 1 : 0;
  if (drop < legModes.length) legModes.splice(drop, 1);
  return {
    stops,
    legModes: fitLegs(legModes, stops.length, fill),
    ...(chain.stopDates
      ? { stopDates: fitDates(chain.stopDates.filter((_, i) => i !== index), stops.length) }
      : {}),
  };
}

/** Move a stop; its date moves with it (a date belongs to the place). Leg modes
 *  can't map cleanly across an arbitrary reorder, so that array is just kept valid
 *  (right length, existing modes by position) — a leg is one tap to re-set. */
export function moveStopTo(chain: StopChain, from: number, to: number, fill: TravelMode): StopChain {
  const stops = moveStop(chain.stops, from, to);
  return {
    stops,
    legModes: fitLegs(chain.legModes, stops.length, fill),
    ...(chain.stopDates ? { stopDates: moveItem(chain.stopDates, from, to) } : {}),
  };
}

/** Set the transport mode of leg `legIndex` (stop legIndex → legIndex+1). */
export function setLegMode(chain: StopChain, legIndex: number, mode: TravelMode): StopChain {
  if (legIndex < 0 || legIndex >= chain.legModes.length) return chain;
  const legModes = [...chain.legModes];
  legModes[legIndex] = mode;
  return { ...chain, legModes };
}

/** Set (or clear, with null) the date of the stop at `stopIndex`. Initialises the
 *  date array (all-null) if the chain wasn't tracking dates yet. */
export function setStopDate(chain: StopChain, stopIndex: number, date: string | null): StopChain {
  if (stopIndex < 0 || stopIndex >= chain.stops.length) return chain;
  const base = fitDates(chain.stopDates ?? chain.stops.map(() => null), chain.stops.length)!;
  const stopDates = [...base];
  stopDates[stopIndex] = date;
  return { ...chain, stopDates };
}

/** The mode of leg `i`: its per-leg override if present, else the fallback default. */
export function legModeAt(
  legModes: TravelMode[] | undefined,
  i: number,
  fallback: TravelMode,
): TravelMode {
  return legModes?.[i] ?? fallback;
}
