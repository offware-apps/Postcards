import { describe, it, expect } from "vitest";
import { moveStop } from "../../src/features/travel/tripStops";
import type { PlaceRef } from "../../src/lib/schema/models";

const p = (id: string): PlaceRef => ({ kind: "airport", id, name: id, countryId: "FR" });
const [a, b, c, d] = [p("A"), p("B"), p("C"), p("D")];

describe("tripStops — immutable ordered-stop helpers (spec 019)", () => {
  it("moveStop reorders with clamped indices", () => {
    expect(moveStop([a, b, c, d], 0, 2).map((s) => s.id)).toEqual(["B", "C", "A", "D"]);
    expect(moveStop([a, b, c], 2, 0).map((s) => s.id)).toEqual(["C", "A", "B"]);
    // Out-of-range destination clamps to the last position.
    expect(moveStop([a, b, c], 0, 99).map((s) => s.id)).toEqual(["B", "C", "A"]);
    // A no-op move returns an equal-length copy.
    const src = [a, b, c];
    expect(moveStop(src, 1, 1).map((s) => s.id)).toEqual(["A", "B", "C"]);
    expect(moveStop(src, 1, 1)).not.toBe(src);
  });
});
